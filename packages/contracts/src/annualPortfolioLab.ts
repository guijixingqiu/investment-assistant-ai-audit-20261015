import crypto from "node:crypto";
import { canonicalJson } from "./decisionContext.js";
import {
  validatePortfolioDecisionContextEnvelope,
  validatePortfolioRiskImpactEnvelope,
  type PortfolioDecisionContextEnvelope,
  type PortfolioRiskImpactEnvelope
} from "./portfolioDecisionContext.js";
import {
  candidateDiscoveryUniverseIsValid,
  type CandidateDiscoveryUniverse
} from "./marketDiscovery.js";
import {
  QUANT_EXECUTION_CALENDAR_METADATA,
  QUANT_FEE_POLICY_SHA256,
  QUANT_FEE_POLICY_VERSION,
  quantManifestExecutionCalendarIsBounded,
  quantManifestFeePolicyGate
} from "./quantRegisteredResearchRun.js";

export const ANNUAL_PORTFOLIO_LAB_SCHEMA_VERSION = "2026-07-17.annual-portfolio-lab.v1";
export const ANNUAL_PORTFOLIO_LAB_CALCULATION_VERSION = "annual-portfolio-lab.v1";
export const ANNUAL_PORTFOLIO_LAB_QUANT_SCHEMA_VERSION = "2026-07-17.quant-portfolio-lab-evidence.v1";

export type AnnualPortfolioLabStatus =
  | "available"
  | "blocked"
  | "not_found"
  | "malformed"
  | "unauthorized"
  | "unavailable";

export interface AnnualPortfolioLabRequestInput {
  scenarioAmounts: number[];
}

export interface AnnualPortfolioLabQuantEvidence {
  schemaVersion: typeof ANNUAL_PORTFOLIO_LAB_QUANT_SCHEMA_VERSION;
  generatedAt: string;
  feePolicyVersion: typeof QUANT_FEE_POLICY_VERSION;
  feePolicySha256: typeof QUANT_FEE_POLICY_SHA256;
  executionCalendar: typeof QUANT_EXECUTION_CALENDAR_METADATA;
  source: {
    snapshotId: string;
    snapshotHash: string;
    dataHash: string;
    sourceClassification: "fixture" | "fixture_market_data_export" | "approved_real_historical";
    adjustment: "none" | "forward" | "backward";
    dataCutoff: string;
    observationStartDate: string;
    observationEndDate: string;
    hkConnectUniverse?: CandidateDiscoveryUniverse;
    universe: Array<{
      market: "HK";
      code: string;
      symbol: string;
      name: string;
      boardLot: number;
    }>;
    sourceIdentity: {
      source: string;
      classification: string;
      provenance: string;
      authority: "research_only";
      asOf: string;
      fetchedAt: string;
      externalFetch: boolean;
      sourceKind: string;
      sourcePath: string;
      sourceHash: string;
      authorizationId?: string;
    };
  };
  method: {
    returnMethod: "close_to_close_simple";
    annualizationDays: number;
    tailConfidence: number;
    covarianceEstimator: "sample_n_minus_1";
    observationAlignment: "exact_common_trading_dates";
    observationCount: number;
    commonTradingDates: string[];
  };
  stability: {
    status: "sample_threshold_met" | "insufficient_tiny_sample";
    minimumStableObservationCount: number;
    observationCount: number;
    limitation: string;
  };
  dailyReturns: Array<{
    tradeDate: string;
    values: Array<{
      symbol: string;
      previousClose: number;
      close: number;
      volume: number;
      turnover: number;
      value: number;
    }>;
  }>;
  series: Array<{
    symbol: string;
    boardLot: number;
    annualizedVolatility: number;
    worstDailyReturn: number;
    historicalTailLossMagnitude: number;
    liquidity: {
      medianDailyVolume: number;
      medianDailyTurnover: number;
      minimumDailyVolume: number;
      minimumDailyTurnover: number;
      zeroVolumeObservationCount: number;
    };
  }>;
  covariance: Array<{
    leftSymbol: string;
    rightSymbol: string;
    annualizedCovariance: number;
    correlation: number | null;
  }>;
  executionEvidence: {
    boardLots: Array<{ symbol: string; boardLot: number }>;
    feeCurrency: "HKD";
    nonZeroCosts: boolean;
    fees: {
      commissionRate: number;
      minCommission: number;
      platformFee: number;
      stampDutyRate: number;
      tradingFeeRate: number;
      transactionLevyRate: number;
    };
    signalTiming: "after_close_t";
    earliestExecution: "next_trading_day_open";
    allowsSameBarExecution: false;
    allowsMargin: false;
  };
  codeIdentity: {
    scriptPath: string;
    scriptHash: string;
    configPath: string;
    configHash: string;
  };
  authority: {
    researchOnly: true;
    advisoryOnly: true;
    currentPortfolioFact: false;
    brokerReconciliation: false;
    accountingAuthority: false;
    recommendation: false;
    ranking: false;
    score: false;
    allocation: false;
    sizing: false;
    targetPrice: false;
    tradeDirection: false;
    orderTradeFillAuthority: false;
    cashFeePositionMutation: false;
    brokerWrite: false;
    productionWrite: false;
  };
  limitations: string[];
  safety: {
    sendsLiveNetworkRequests: false;
    writesDatabase: false;
    callsBroker: false;
    createsOrder: false;
    createsTrade: false;
    mutatesOfficialPortfolio: false;
  };
  evidenceId: string;
}

export interface AnnualPortfolioHistoricalMetrics {
  status: "available" | "not_captured" | "unavailable";
  annualizedVolatility: number | null;
  historicalStressLossMagnitude: number | null;
  historicalStressDate: string | null;
  historicalTailLossMagnitude: number | null;
  candidateRiskContribution: number | null;
  limitation: string;
}

export interface AnnualPortfolioLabData {
  target: {
    membershipId: string;
    membershipVersion: number;
    membershipState: "tracked" | "paused";
    market: "HK";
    code: string;
    symbol: string;
  };
  sourceIdentity: {
    accountScopeId: string;
    portfolioContextId: string;
    portfolioSnapshotId: string;
    portfolioAsOf: string;
    decisionContextId: string;
    decisionContextHash: string;
    quote: {
      snapshotId: string;
      symbol: string;
      currency: "HKD";
      price: number;
      quoteTime: string;
      fetchedAt: string;
      source: string;
    };
  };
  portfolio: PortfolioDecisionContextEnvelope;
  dimensions: {
    positions: Array<{
      sourceIndex: number;
      symbol: string;
      name: string | null;
      currency: "HKD";
      marketValue: number;
      marketWeight: number;
      sector: {
        status: "not_captured";
        value: null;
        limitation: string;
      };
    }>;
    candidate: {
      symbol: string;
      name: string | null;
      currency: "HKD";
      currentlyHeld: boolean;
      sector: {
        status: "not_captured";
        value: null;
        limitation: string;
      };
    };
    currency: {
      status: "single_currency";
      currencies: ["HKD"];
      marketValueByCurrency: Array<{ currency: "HKD"; marketValue: number; weight: 1 }>;
    };
  };
  current: {
    totalMarketValue: number;
    candidateMarketValue: number;
    candidateWeight: number;
    largestPositionWeight: number;
    hhi: number;
    historical: AnnualPortfolioHistoricalMetrics;
  };
  scenarios: AnnualPortfolioLabScenario[];
  quant: AnnualPortfolioLabQuantView;
}

export interface AnnualPortfolioLabScenario {
  sourceIndex: number;
  scenarioId: string;
  hypotheticalAmount: number;
  riskImpact: PortfolioRiskImpactEnvelope;
  comparison: {
    candidateWeightChange: number;
    largestPositionWeightChange: number;
    hhiChange: number;
    otherPositionWeightChanges: Array<{
      symbol: string;
      currentWeight: number;
      scenarioWeight: number;
      weightChange: number;
    }>;
    fundingSourceStatus: "not_captured";
    cashStatus: "unknown";
    opportunityCostLimitation: string;
  };
  historical: AnnualPortfolioHistoricalMetrics & {
    annualizedVolatilityChange: number | null;
    historicalStressLossChange: number | null;
    historicalTailLossChange: number | null;
    candidateRiskContributionChange: number | null;
  };
}

export interface AnnualPortfolioLabQuantView {
  evidenceStatus: "available" | "missing" | "malformed" | "unavailable";
  evidence: AnnualPortfolioLabQuantEvidence | null;
  coverage: {
    status: "exact" | "incomplete" | "unavailable";
    requiredSymbols: string[];
    coveredSymbols: string[];
    missingSymbols: string[];
    extraEvidenceSymbols: string[];
  };
  correlations: {
    status: "available" | "not_captured" | "unavailable";
    observationStartDate: string | null;
    observationEndDate: string | null;
    observationCount: number | null;
    stability: "sample_threshold_met" | "insufficient_tiny_sample" | "unavailable";
    candidateToPositions: Array<{ symbol: string; correlation: number | null }>;
    limitation: string;
  };
  candidateLiquidity: {
    status: "available" | "not_captured" | "unavailable";
    symbol: string;
    observationCount: number | null;
    medianDailyVolume: number | null;
    medianDailyTurnover: number | null;
    minimumDailyVolume: number | null;
    minimumDailyTurnover: number | null;
    zeroVolumeObservationCount: number | null;
    boardLot: number | null;
    feeCurrency: "HKD" | null;
    nonZeroCosts: boolean | null;
    fees: AnnualPortfolioLabQuantEvidence["executionEvidence"]["fees"] | null;
    limitation: string;
  };
  limitations: string[];
}

export interface AnnualPortfolioLabEnvelope {
  schemaVersion: typeof ANNUAL_PORTFOLIO_LAB_SCHEMA_VERSION;
  calculationVersion: typeof ANNUAL_PORTFOLIO_LAB_CALCULATION_VERSION;
  generatedAt: string;
  status: AnnualPortfolioLabStatus;
  labId: string | null;
  membershipId: string;
  requestedActorId: string;
  requestedSymbol: string | null;
  data: AnnualPortfolioLabData | null;
  gaps: string[];
  safety: {
    advisoryOnly: true;
    userProvidedAmountsOnly: true;
    preservesScenarioOrder: true;
    changesCandidateOrdering: false;
    recommendation: false;
    ranking: false;
    score: false;
    suggestedAmount: false;
    targetWeight: false;
    targetPrice: false;
    tradeDirection: false;
    createsOrder: false;
    createsTrade: false;
    callsBroker: false;
    mutatesOfficialPortfolio: false;
    productionWrite: false;
  };
  message: string;
}

export type AnnualPortfolioLabHashInput = Omit<AnnualPortfolioLabEnvelope, "labId" | "generatedAt">;
export type AnnualPortfolioScenarioHashInput = Omit<AnnualPortfolioLabScenario, "scenarioId">;

export function computeAnnualPortfolioLabId(input: AnnualPortfolioLabHashInput): string {
  return `annual-portfolio-lab:${sha256(canonicalJson(input))}`;
}

export function annualPortfolioLabHashInput(envelope: AnnualPortfolioLabEnvelope): AnnualPortfolioLabHashInput {
  const { labId: _labId, generatedAt: _generatedAt, ...input } = envelope;
  return input;
}

export function computeAnnualPortfolioScenarioId(input: AnnualPortfolioScenarioHashInput): string {
  return `annual-portfolio-scenario:${sha256(canonicalJson(input))}`;
}

export function computeAnnualPortfolioLabQuantEvidenceId(
  input: Omit<AnnualPortfolioLabQuantEvidence, "evidenceId">
): string {
  return `annual-portfolio-lab-quant:${sha256(canonicalJson(input))}`;
}

export function validateAnnualPortfolioLabRequestInput(value: unknown):
  | { ok: true; value: AnnualPortfolioLabRequestInput }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value) || !Array.isArray(value.scenarioAmounts)) {
    return { ok: false, errors: ["scenarioAmounts must be an array"] };
  }
  exactKeys(value, ["scenarioAmounts"], "portfolio lab input", errors);
  if (value.scenarioAmounts.length < 1 || value.scenarioAmounts.length > 4) {
    errors.push("scenarioAmounts must contain between 1 and 4 user amounts");
  }
  for (const [index, amount] of value.scenarioAmounts.entries()) {
    if (!finiteNumber(amount) || amount < 0 || amount > 1_000_000_000_000) {
      errors.push(`scenarioAmounts[${index}] must be between 0 and 1000000000000`);
    }
  }
  return errors.length === 0
    ? { ok: true, value: { scenarioAmounts: [...value.scenarioAmounts] as number[] } }
    : { ok: false, errors };
}

export function validateAnnualPortfolioLabQuantEvidence(value: unknown):
  | { ok: true; value: AnnualPortfolioLabQuantEvidence }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["quant portfolio evidence must be an object"] };
  exactKeys(value, [
    "schemaVersion", "generatedAt", "source", "method", "stability", "dailyReturns",
    "series", "covariance", "executionEvidence", "codeIdentity", "authority",
    "limitations", "safety", "evidenceId",
    "feePolicyVersion", "feePolicySha256", "executionCalendar"
  ], "quant portfolio evidence", errors);
  if (value.schemaVersion !== ANNUAL_PORTFOLIO_LAB_QUANT_SCHEMA_VERSION) errors.push("quant evidence schemaVersion is invalid");
  strictInstant(value.generatedAt, "quant evidence generatedAt", errors);
  if (!quantManifestFeePolicyGate(value).ok) errors.push("quant evidence fee policy identity is invalid");
  if (!quantManifestExecutionCalendarIsBounded(value)) errors.push("quant evidence execution calendar is invalid");
  if (isRecord(value.executionCalendar)) exactKeys(value.executionCalendar,
    ["timing", "calendarCompleteness"], "quant evidence execution calendar", errors);
  validateQuantSource(value.source, errors);
  validateQuantMethod(value.method, errors);
  validateQuantStability(value.stability, value.method, errors);
  validateQuantDailyReturns(value.dailyReturns, value.source, value.method, errors);
  validateQuantSeries(value.series, value.dailyReturns, value.source, value.method, errors);
  validateQuantCovariance(value.covariance, value.dailyReturns, value.source, value.method, errors);
  validateQuantExecution(value.executionEvidence, value.source, errors);
  validateQuantCodeIdentity(value.codeIdentity, errors);
  validateQuantAuthority(value.authority, errors);
  boundedStrings(value.limitations, "quant evidence limitations", 50, errors);
  validateQuantSafety(value.safety, errors);
  if (!nonEmptyString(value.evidenceId)) errors.push("quant evidence evidenceId is required");
  else {
    const { evidenceId: _evidenceId, ...input } = value;
    if (value.evidenceId !== computeAnnualPortfolioLabQuantEvidenceId(input as Omit<AnnualPortfolioLabQuantEvidence, "evidenceId">)) {
      errors.push("quant evidence evidenceId does not match canonical content");
    }
  }
  return errors.length === 0
    ? { ok: true, value: value as unknown as AnnualPortfolioLabQuantEvidence }
    : { ok: false, errors };
}

export function validateAnnualPortfolioLabEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["portfolio lab envelope must be an object"] };
  exactKeys(value, [
    "schemaVersion", "calculationVersion", "generatedAt", "status", "labId",
    "membershipId", "requestedActorId", "requestedSymbol", "data", "gaps", "safety", "message"
  ], "portfolio lab envelope", errors);
  if (value.schemaVersion !== ANNUAL_PORTFOLIO_LAB_SCHEMA_VERSION) errors.push("portfolio lab schemaVersion is invalid");
  if (value.calculationVersion !== ANNUAL_PORTFOLIO_LAB_CALCULATION_VERSION) errors.push("portfolio lab calculationVersion is invalid");
  strictInstant(value.generatedAt, "generatedAt", errors);
  if (!["available", "blocked", "not_found", "malformed", "unauthorized", "unavailable"].includes(String(value.status))) errors.push("portfolio lab status is invalid");
  nullableString(value.labId, "labId", errors);
  nonEmpty(value.membershipId, "membershipId", errors);
  nonEmpty(value.requestedActorId, "requestedActorId", errors);
  nullableString(value.requestedSymbol, "requestedSymbol", errors);
  boundedStrings(value.gaps, "portfolio lab gaps", 100, errors, true);
  validateLabSafety(value.safety, errors);
  nonEmpty(value.message, "message", errors);
  if (value.status === "available") {
    if (!isRecord(value.data)) errors.push("available portfolio lab requires data");
    else validateLabData(value, value.data, errors);
    if (!nonEmptyString(value.labId)) errors.push("available portfolio lab requires labId");
    if (!/^HK\.\d{5}$/.test(String(value.requestedSymbol))) errors.push("available portfolio lab requires requestedSymbol");
  } else {
    if (value.data !== null || value.labId !== null || value.requestedSymbol !== null) {
      errors.push("non-available portfolio lab must clear data, labId, and requestedSymbol");
    }
  }
  if (typeof value.labId === "string") {
    const { labId: _labId, generatedAt: _generatedAt, ...input } = value;
    if (value.labId !== computeAnnualPortfolioLabId(input as AnnualPortfolioLabHashInput)) {
      errors.push("portfolio lab labId does not match canonical content");
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function annualPortfolioHistoricalMetrics(
  evidence: AnnualPortfolioLabQuantEvidence,
  weights: Map<string, number>,
  candidateSymbol: string,
  status: "available" | "not_captured" | "unavailable" = "available",
  limitation = "Historical metrics use the exact canonical quant window and current fact weights as research evidence only."
): AnnualPortfolioHistoricalMetrics {
  if (status !== "available") return unavailableHistorical(status, limitation);
  const portfolioReturns = evidence.dailyReturns.map((row) => ({
    tradeDate: row.tradeDate,
    value: row.values.reduce((total, item) => total + (weights.get(item.symbol) ?? 0) * item.value, 0)
  }));
  const values = portfolioReturns.map((item) => item.value);
  const worst = [...portfolioReturns].sort((left, right) => left.value - right.value || left.tradeDate.localeCompare(right.tradeDate))[0];
  const contribution = candidateRiskContribution(evidence, weights, candidateSymbol);
  return {
    status: "available",
    annualizedVolatility: round(sampleStandardDeviation(values) * Math.sqrt(evidence.method.annualizationDays), 10),
    historicalStressLossMagnitude: round(Math.max(0, -worst.value), 10),
    historicalStressDate: worst.tradeDate,
    historicalTailLossMagnitude: round(historicalTailLoss(values, evidence.method.tailConfidence), 10),
    candidateRiskContribution: contribution === null ? null : round(contribution, 10),
    limitation
  };
}

function validateLabData(envelope: Record<string, unknown>, data: Record<string, unknown>, errors: string[]): void {
  exactKeys(data, ["target", "sourceIdentity", "portfolio", "dimensions", "current", "scenarios", "quant"], "portfolio lab data", errors);
  const target = data.target;
  const source = data.sourceIdentity;
  const portfolio = data.portfolio;
  if (!isRecord(target)) errors.push("portfolio lab target is required");
  else {
    exactKeys(target, ["membershipId", "membershipVersion", "membershipState", "market", "code", "symbol"], "portfolio lab target", errors);
    if (target.membershipId !== envelope.membershipId || target.symbol !== envelope.requestedSymbol) errors.push("portfolio lab target must match envelope identity");
    if (!Number.isSafeInteger(target.membershipVersion) || Number(target.membershipVersion) < 1) errors.push("target membershipVersion is invalid");
    if (target.membershipState !== "tracked" && target.membershipState !== "paused") errors.push("target membershipState must be tracked or paused");
    if (target.market !== "HK" || !/^\d{5}$/.test(String(target.code)) || target.symbol !== `HK.${target.code}`) errors.push("target symbol identity is invalid");
  }
  if (!isRecord(source)) errors.push("portfolio lab sourceIdentity is required");
  else validateLabSource(source, target, errors);
  const portfolioValidation = validatePortfolioDecisionContextEnvelope(portfolio);
  if (!portfolioValidation.ok) errors.push(...portfolioValidation.errors.map((error) => `portfolio.${error}`));
  if (isRecord(portfolio) && !["available", "stale"].includes(String(portfolio.status))) errors.push("available portfolio lab requires a complete current or explicitly stale portfolio");
  if (isRecord(portfolio) && isRecord(source)) {
    if (portfolio.contextId !== source.portfolioContextId
      || portfolio.portfolioSnapshotId !== source.portfolioSnapshotId
      || portfolio.accountScopeId !== source.accountScopeId
      || portfolio.portfolioAsOf !== source.portfolioAsOf) {
      errors.push("portfolio lab source identity must bind the exact current portfolio");
    }
  }
  validateDimensions(data.dimensions, portfolio, target, source, errors);
  validateCurrent(data.current, portfolio, target, errors);
  validateQuantView(data.quant, portfolio, target, data.current, data.scenarios, errors);
  validateScenarios(data.scenarios, portfolio, target, data.current, data.quant, errors);
}

function validateLabSource(value: Record<string, unknown>, target: unknown, errors: string[]): void {
  exactKeys(value, ["accountScopeId", "portfolioContextId", "portfolioSnapshotId", "portfolioAsOf", "decisionContextId", "decisionContextHash", "quote"], "portfolio lab sourceIdentity", errors);
  for (const field of ["accountScopeId", "portfolioContextId", "portfolioSnapshotId", "decisionContextId", "decisionContextHash"]) nonEmpty(value[field], `sourceIdentity.${field}`, errors);
  strictInstant(value.portfolioAsOf, "sourceIdentity.portfolioAsOf", errors);
  if (!isRecord(value.quote)) errors.push("sourceIdentity.quote is required");
  else {
    exactKeys(value.quote, ["snapshotId", "symbol", "currency", "price", "quoteTime", "fetchedAt", "source"], "sourceIdentity.quote", errors);
    for (const field of ["snapshotId", "symbol"]) nonEmpty(value.quote[field], `sourceIdentity.quote.${field}`, errors);
    if (value.quote.source !== "futu") errors.push("sourceIdentity.quote.source must be futu");
    if (isRecord(target) && value.quote.symbol !== target.symbol) errors.push("sourceIdentity quote symbol must match target");
    if (value.quote.currency !== "HKD" || !finitePositive(value.quote.price)) errors.push("sourceIdentity quote must contain a positive HKD price");
    strictInstant(value.quote.quoteTime, "sourceIdentity.quote.quoteTime", errors);
    strictInstant(value.quote.fetchedAt, "sourceIdentity.quote.fetchedAt", errors);
  }
}
function validateDimensions(value: unknown, portfolio: unknown, target: unknown, source: unknown, errors: string[]): void {
  if (!isRecord(value)) { errors.push("portfolio lab dimensions are required"); return; }
  exactKeys(value, ["positions", "candidate", "currency"], "portfolio lab dimensions", errors);
  const positions = isRecord(portfolio) && Array.isArray(portfolio.positions) ? portfolio.positions : [];
  if (!Array.isArray(value.positions) || value.positions.length !== positions.length) errors.push("dimension positions must cover current portfolio positions");
  else value.positions.forEach((item, index) => {
    if (!isRecord(item)) { errors.push(`dimension position ${index} is invalid`); return; }
    exactKeys(item, ["sourceIndex", "symbol", "name", "currency", "marketValue", "marketWeight", "sector"], `dimension position ${index}`, errors);
    const position = isRecord(positions[index]) ? positions[index] : null;
    if (item.sourceIndex !== index || item.symbol !== position?.symbol || item.name !== position?.name
      || item.currency !== "HKD" || item.marketValue !== position?.marketValue || item.marketWeight !== position?.marketWeight) {
      errors.push(`dimension position ${index} must bind current portfolio source order and facts`);
    }
    validateSectorGap(item.sector, `dimension position ${index} sector`, errors);
  });
  if (!isRecord(value.candidate)) errors.push("candidate dimension is required");
  else {
    exactKeys(value.candidate, ["symbol", "name", "currency", "currentlyHeld", "sector"], "candidate dimension", errors);
    if (!isRecord(target) || !isRecord(source) || !isRecord(source.quote)
      || value.candidate.symbol !== target.symbol || value.candidate.currency !== "HKD"
      || value.candidate.name !== (source.quote.name ?? value.candidate.name)
      || value.candidate.currentlyHeld !== positions.some((position) => isRecord(position) && position.symbol === target.symbol)) {
      errors.push("candidate dimension must bind target and current holdings");
    }
    validateSectorGap(value.candidate.sector, "candidate sector", errors);
  }
  if (!isRecord(value.currency)) errors.push("currency dimension is required");
  else {
    exactKeys(value.currency, ["status", "currencies", "marketValueByCurrency"], "currency dimension", errors);
    if (value.currency.status !== "single_currency" || !sameStrings(value.currency.currencies, ["HKD"])) errors.push("currency dimension must remain single HKD");
    const total = isRecord(portfolio) && isRecord(portfolio.summary) && isRecord(portfolio.summary.marketValue)
      ? portfolio.summary.marketValue.amount : null;
    const rows = value.currency.marketValueByCurrency;
    if (!Array.isArray(rows) || rows.length !== 1 || !isRecord(rows[0])
      || rows[0].currency !== "HKD" || rows[0].marketValue !== total || rows[0].weight !== 1) {
      errors.push("currency dimension must bind the complete HKD market value");
    }
  }
}

function validateCurrent(value: unknown, portfolio: unknown, target: unknown, errors: string[]): void {
  if (!isRecord(value)) { errors.push("portfolio lab current baseline is required"); return; }
  exactKeys(value, ["totalMarketValue", "candidateMarketValue", "candidateWeight", "largestPositionWeight", "hhi", "historical"], "portfolio lab current", errors);
  if (!isRecord(portfolio) || !isRecord(portfolio.summary) || !isRecord(portfolio.summary.marketValue)
    || !isRecord(portfolio.summary.concentration) || !isRecord(target)) return;
  const positions = Array.isArray(portfolio.positions) ? portfolio.positions.filter(isRecord) : [];
  const candidate = positions.find((position) => position.symbol === target.symbol);
  const expectedMarketValue = candidate?.marketValue ?? 0;
  const expectedWeight = candidate?.marketWeight ?? 0;
  if (value.totalMarketValue !== portfolio.summary.marketValue.amount
    || value.candidateMarketValue !== expectedMarketValue || value.candidateWeight !== expectedWeight
    || value.largestPositionWeight !== portfolio.summary.concentration.largestPositionWeight
    || value.hhi !== portfolio.summary.concentration.hhi) {
    errors.push("portfolio lab current baseline must bind current portfolio calculations");
  }
  validateHistoricalShape(value.historical, "current historical", errors);
}

function validateScenarios(value: unknown, portfolio: unknown, target: unknown, current: unknown, quant: unknown, errors: string[]): void {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) { errors.push("portfolio lab scenarios must contain one to four entries"); return; }
  value.forEach((scenario, index) => {
    if (!isRecord(scenario)) { errors.push(`scenario ${index} is invalid`); return; }
    exactKeys(scenario, ["sourceIndex", "scenarioId", "hypotheticalAmount", "riskImpact", "comparison", "historical"], `scenario ${index}`, errors);
    if (scenario.sourceIndex !== index || !finiteNumber(scenario.hypotheticalAmount) || Number(scenario.hypotheticalAmount) < 0) errors.push(`scenario ${index} source order or amount is invalid`);
    const riskValidation = validatePortfolioRiskImpactEnvelope(scenario.riskImpact);
    if (!riskValidation.ok) errors.push(...riskValidation.errors.map((error) => `scenario ${index} riskImpact.${error}`));
    if (isRecord(scenario.riskImpact) && isRecord(portfolio) && isRecord(target)) {
      validateRiskBinding(scenario.riskImpact, portfolio, target.symbol, scenario.hypotheticalAmount, `scenario ${index}`, errors);
    }
    validateScenarioComparison(scenario.comparison, portfolio, scenario.riskImpact, current, target, `scenario ${index}`, errors);
    validateScenarioHistorical(scenario.historical, quant, current, scenario.riskImpact, portfolio, target, `scenario ${index}`, errors);
    if (nonEmptyString(scenario.scenarioId)) {
      const { scenarioId: _scenarioId, ...input } = scenario;
      if (scenario.scenarioId !== computeAnnualPortfolioScenarioId(input as unknown as AnnualPortfolioScenarioHashInput)) errors.push(`scenario ${index} scenarioId does not match canonical content`);
    } else errors.push(`scenario ${index} scenarioId is required`);
  });
}

function validateRiskBinding(risk: Record<string, unknown>, portfolio: Record<string, unknown>, symbol: unknown, amount: unknown, label: string, errors: string[]): void {
  if (risk.status !== "available" || risk.contextId !== portfolio.contextId || risk.portfolioSnapshotId !== portfolio.portfolioSnapshotId
    || risk.candidateSymbol !== symbol || risk.hypotheticalAmount !== amount) {
    errors.push(`${label} risk impact must bind current portfolio, candidate, and amount`);
    return;
  }
  const total = isRecord(portfolio.summary) && isRecord(portfolio.summary.marketValue) ? portfolio.summary.marketValue.amount : null;
  const positions = Array.isArray(portfolio.positions) ? portfolio.positions.filter(isRecord) : [];
  const currentPosition = positions.find((position) => position.symbol === symbol);
  if (!finitePositive(total) || !finiteNumber(amount) || !isRecord(risk.current) || !isRecord(risk.scenario)) return;
  const currentMarketValue = currentPosition?.marketValue ?? 0;
  const currentWeight = currentPosition?.marketWeight ?? 0;
  const scenarioTotal = round(total + amount, 2);
  const candidateValue = round(Number(currentMarketValue) + amount, 2);
  const candidateWeight = scenarioTotal === 0 ? 0 : round(candidateValue / scenarioTotal, 8);
  const values = positions.filter((position) => position.symbol !== symbol).map((position) => Number(position.marketValue ?? 0));
  values.push(candidateValue);
  const weights = values.map((item) => scenarioTotal === 0 ? 0 : item / scenarioTotal).sort((left, right) => right - left);
  const expectedHhi = round(weights.reduce((sum, item) => sum + item ** 2, 0), 8);
  if (risk.current.alreadyHeld !== Boolean(currentPosition) || risk.current.marketValue !== currentMarketValue || risk.current.weight !== currentWeight
    || risk.scenario.totalMarketValue !== scenarioTotal || risk.scenario.candidateMarketValue !== candidateValue
    || risk.scenario.candidateWeight !== candidateWeight || risk.scenario.weightChange !== round(candidateWeight - Number(currentWeight), 8)
    || risk.scenario.largestPositionWeight !== round(weights[0] ?? 0, 8) || risk.scenario.hhi !== expectedHhi) {
    errors.push(`${label} risk impact calculations must recompute from current portfolio facts`);
  }
}

function validateScenarioComparison(value: unknown, portfolio: unknown, risk: unknown, current: unknown, target: unknown, label: string, errors: string[]): void {
  if (!isRecord(value)) { errors.push(`${label} comparison is required`); return; }
  exactKeys(value, ["candidateWeightChange", "largestPositionWeightChange", "hhiChange", "otherPositionWeightChanges", "fundingSourceStatus", "cashStatus", "opportunityCostLimitation"], `${label} comparison`, errors);
  if (!isRecord(risk) || !isRecord(risk.scenario) || !isRecord(current) || !isRecord(portfolio) || !isRecord(target)) return;
  if (value.candidateWeightChange !== risk.scenario.weightChange
    || value.largestPositionWeightChange !== round(Number(risk.scenario.largestPositionWeight) - Number(current.largestPositionWeight), 8)
    || value.hhiChange !== round(Number(risk.scenario.hhi) - Number(current.hhi), 8)) {
    errors.push(`${label} concentration comparison must recompute from current and scenario facts`);
  }
  const positions = Array.isArray(portfolio.positions) ? portfolio.positions.filter(isRecord) : [];
  const expected = positions.filter((position) => position.symbol !== target.symbol).map((position) => ({
    symbol: position.symbol,
    currentWeight: position.marketWeight,
    scenarioWeight: round(Number(position.marketValue) / Number(risk.scenario.totalMarketValue), 8),
    weightChange: round(Number(position.marketValue) / Number(risk.scenario.totalMarketValue) - Number(position.marketWeight), 8)
  }));
  if (!sameCanonical(value.otherPositionWeightChanges, expected)) errors.push(`${label} other-position opportunity cost must preserve portfolio source order and recompute weights`);
  if (value.fundingSourceStatus !== "not_captured" || value.cashStatus !== "unknown" || !nonEmptyString(value.opportunityCostLimitation)) errors.push(`${label} must keep funding source and cash unknown`);
}

function validateQuantView(value: unknown, portfolio: unknown, target: unknown, current: unknown, scenarios: unknown, errors: string[]): void {
  if (!isRecord(value)) { errors.push("portfolio lab quant view is required"); return; }
  exactKeys(value, ["evidenceStatus", "evidence", "coverage", "correlations", "candidateLiquidity", "limitations"], "portfolio lab quant", errors);
  if (!["available", "missing", "malformed", "unavailable"].includes(String(value.evidenceStatus))) errors.push("quant evidenceStatus is invalid");
  let evidence: AnnualPortfolioLabQuantEvidence | null = null;
  if (value.evidence === null) {
    if (value.evidenceStatus === "available") errors.push("available quant status requires evidence");
  } else {
    const validated = validateAnnualPortfolioLabQuantEvidence(value.evidence);
    if (!validated.ok) errors.push(...validated.errors.map((error) => `quant.evidence.${error}`));
    else evidence = validated.value;
    if (value.evidenceStatus !== "available") errors.push("quant evidence must be hidden unless evidenceStatus is available");
  }
  const required = isRecord(portfolio) && Array.isArray(portfolio.positions) && isRecord(target)
    ? unique([...portfolio.positions.filter(isRecord).map((position) => String(position.symbol)), String(target.symbol)]) : [];
  validateCoverage(value.coverage, required, evidence, errors);
  validateCorrelations(value.correlations, value.coverage, evidence, target, portfolio, errors);
  validateLiquidity(value.candidateLiquidity, evidence, target, errors);
  boundedStrings(value.limitations, "quant view limitations", 100, errors);
  if (isRecord(value.coverage) && value.coverage.status === "exact" && evidence && isRecord(current) && Array.isArray(scenarios)) {
    const currentWeights = currentWeightsFromPortfolio(portfolio);
    const expectedCurrent = annualPortfolioHistoricalMetrics(evidence, currentWeights, String(isRecord(target) ? target.symbol : ""));
    if (!sameHistorical(current.historical, expectedCurrent)) errors.push("current historical metrics must recompute from exact quant evidence and current weights");
  }
}

function validateCoverage(value: unknown, required: string[], evidence: AnnualPortfolioLabQuantEvidence | null, errors: string[]): void {
  if (!isRecord(value)) { errors.push("quant coverage is required"); return; }
  exactKeys(value, ["status", "requiredSymbols", "coveredSymbols", "missingSymbols", "extraEvidenceSymbols"], "quant coverage", errors);
  const universe = evidence?.source.universe.map((item) => item.symbol) ?? [];
  const covered = required.filter((symbol) => universe.includes(symbol));
  const missing = required.filter((symbol) => !universe.includes(symbol));
  const extra = universe.filter((symbol) => !required.includes(symbol));
  const status = !evidence ? "unavailable" : missing.length === 0 ? "exact" : "incomplete";
  if (value.status !== status || !sameStrings(value.requiredSymbols, required) || !sameStrings(value.coveredSymbols, covered)
    || !sameStrings(value.missingSymbols, missing) || !sameStrings(value.extraEvidenceSymbols, extra)) {
    errors.push("quant coverage must derive from exact current-position and candidate symbols");
  }
}

function validateCorrelations(value: unknown, coverage: unknown, evidence: AnnualPortfolioLabQuantEvidence | null, target: unknown, portfolio: unknown, errors: string[]): void {
  if (!isRecord(value)) { errors.push("quant correlations are required"); return; }
  exactKeys(value, ["status", "observationStartDate", "observationEndDate", "observationCount", "stability", "candidateToPositions", "limitation"], "quant correlations", errors);
  const exact = isRecord(coverage) && coverage.status === "exact" && evidence && isRecord(target) && isRecord(portfolio);
  const expectedStatus = exact ? "available" : evidence ? "not_captured" : "unavailable";
  if (value.status !== expectedStatus) errors.push("correlation status must match exact quant coverage");
  if (!exact) {
    if (value.observationStartDate !== null || value.observationEndDate !== null || value.observationCount !== null
      || value.stability !== "unavailable" || !Array.isArray(value.candidateToPositions) || value.candidateToPositions.length !== 0) {
      errors.push("non-available correlations must clear every metric");
    }
  } else {
    if (value.observationStartDate !== evidence.source.observationStartDate || value.observationEndDate !== evidence.source.observationEndDate
      || value.observationCount !== evidence.method.observationCount || value.stability !== evidence.stability.status) errors.push("correlation window must bind quant evidence");
    const positions = Array.isArray(portfolio.positions) ? portfolio.positions.filter(isRecord) : [];
    const expected = positions.filter((position) => position.symbol !== target.symbol).map((position) => ({
      symbol: position.symbol,
      correlation: correlationFor(evidence, String(target.symbol), String(position.symbol))
    }));
    if (!sameCanonical(value.candidateToPositions, expected)) errors.push("candidate correlations must preserve current portfolio source order and canonical covariance facts");
  }
  nonEmpty(value.limitation, "correlation limitation", errors);
}

function validateLiquidity(value: unknown, evidence: AnnualPortfolioLabQuantEvidence | null, target: unknown, errors: string[]): void {
  if (!isRecord(value)) { errors.push("candidate liquidity is required"); return; }
  exactKeys(value, ["status", "symbol", "observationCount", "medianDailyVolume", "medianDailyTurnover", "minimumDailyVolume", "minimumDailyTurnover", "zeroVolumeObservationCount", "boardLot", "feeCurrency", "nonZeroCosts", "fees", "limitation"], "candidate liquidity", errors);
  const symbol = isRecord(target) ? String(target.symbol) : "";
  if (value.symbol !== symbol) errors.push("candidate liquidity symbol must match target");
  const series = evidence?.series.find((item) => item.symbol === symbol) ?? null;
  const status = series ? "available" : evidence ? "not_captured" : "unavailable";
  if (value.status !== status) errors.push("candidate liquidity status must match exact candidate evidence");
  if (!series || !evidence) {
    for (const field of ["observationCount", "medianDailyVolume", "medianDailyTurnover", "minimumDailyVolume", "minimumDailyTurnover", "zeroVolumeObservationCount", "boardLot", "feeCurrency", "nonZeroCosts", "fees"]) {
      if (value[field] !== null) errors.push(`non-available candidate liquidity must clear ${field}`);
    }
  } else if (value.observationCount !== evidence.method.observationCount
    || value.medianDailyVolume !== series.liquidity.medianDailyVolume
    || value.medianDailyTurnover !== series.liquidity.medianDailyTurnover
    || value.minimumDailyVolume !== series.liquidity.minimumDailyVolume
    || value.minimumDailyTurnover !== series.liquidity.minimumDailyTurnover
    || value.zeroVolumeObservationCount !== series.liquidity.zeroVolumeObservationCount
    || value.boardLot !== series.boardLot || value.feeCurrency !== evidence.executionEvidence.feeCurrency
    || value.nonZeroCosts !== evidence.executionEvidence.nonZeroCosts
    || !sameCanonical(value.fees, evidence.executionEvidence.fees)) {
    errors.push("candidate liquidity and execution facts must bind canonical quant evidence");
  }
  nonEmpty(value.limitation, "candidate liquidity limitation", errors);
}

function validateScenarioHistorical(value: unknown, quant: unknown, current: unknown, risk: unknown, portfolio: unknown, target: unknown, label: string, errors: string[]): void {
  if (!isRecord(value)) { errors.push(`${label} historical metrics are required`); return; }
  exactKeys(value, ["status", "annualizedVolatility", "historicalStressLossMagnitude", "historicalStressDate", "historicalTailLossMagnitude", "candidateRiskContribution", "limitation", "annualizedVolatilityChange", "historicalStressLossChange", "historicalTailLossChange", "candidateRiskContributionChange"], `${label} historical`, errors);
  validateHistoricalShape(value, `${label} historical`, errors, true);
  const exact = isRecord(quant) && isRecord(quant.coverage) && quant.coverage.status === "exact" && isRecord(quant.evidence)
    && isRecord(risk) && isRecord(risk.scenario) && isRecord(portfolio) && isRecord(target);
  if (!exact) {
    for (const field of ["annualizedVolatilityChange", "historicalStressLossChange", "historicalTailLossChange", "candidateRiskContributionChange"]) if (value[field] !== null) errors.push(`${label} unavailable historical changes must be null`);
    return;
  }
  const weights = scenarioWeightsFromRisk(portfolio, risk, String(target.symbol));
  const expected = annualPortfolioHistoricalMetrics(quant.evidence as unknown as AnnualPortfolioLabQuantEvidence, weights, String(target.symbol));
  const currentHistorical = isRecord(current) && isRecord(current.historical) ? current.historical : null;
  if (!sameHistorical(value, expected)
    || value.annualizedVolatilityChange !== nullableDifference(expected.annualizedVolatility, currentHistorical?.annualizedVolatility)
    || value.historicalStressLossChange !== nullableDifference(expected.historicalStressLossMagnitude, currentHistorical?.historicalStressLossMagnitude)
    || value.historicalTailLossChange !== nullableDifference(expected.historicalTailLossMagnitude, currentHistorical?.historicalTailLossMagnitude)
    || value.candidateRiskContributionChange !== nullableDifference(expected.candidateRiskContribution, currentHistorical?.candidateRiskContribution)) {
    errors.push(`${label} historical metrics and deltas must recompute from exact evidence and scenario weights`);
  }
}

function validateHistoricalShape(value: unknown, label: string, errors: string[], changes = false): void {
  if (!isRecord(value)) { errors.push(`${label} is required`); return; }
  const base = ["status", "annualizedVolatility", "historicalStressLossMagnitude", "historicalStressDate", "historicalTailLossMagnitude", "candidateRiskContribution", "limitation"];
  if (!changes) exactKeys(value, base, label, errors);
  if (!["available", "not_captured", "unavailable"].includes(String(value.status))) errors.push(`${label} status is invalid`);
  for (const field of ["annualizedVolatility", "historicalStressLossMagnitude", "historicalTailLossMagnitude", "candidateRiskContribution"]) nullableFinite(value[field], `${label}.${field}`, errors);
  nullableString(value.historicalStressDate, `${label}.historicalStressDate`, errors);
  nonEmpty(value.limitation, `${label}.limitation`, errors);
  if (value.status !== "available" && ["annualizedVolatility", "historicalStressLossMagnitude", "historicalStressDate", "historicalTailLossMagnitude", "candidateRiskContribution"].some((field) => value[field] !== null)) errors.push(`${label} non-available state must clear metrics`);
}

function validateQuantSource(value: unknown, errors: string[]): void {
  if (!isRecord(value)) { errors.push("quant evidence source is required"); return; }
  exactKeysWithOptional(value, ["snapshotId", "snapshotHash", "dataHash", "sourceClassification", "adjustment", "dataCutoff", "observationStartDate", "observationEndDate", "hkConnectUniverse", "universe", "sourceIdentity"], ["hkConnectUniverse"], "quant evidence source", errors);
  for (const field of ["snapshotId", "snapshotHash", "dataHash"]) nonEmpty(value[field], `quant source ${field}`, errors);
  if (!/^[a-f0-9]{64}$/i.test(String(value.snapshotHash)) || !/^[a-f0-9]{64}$/i.test(String(value.dataHash))) errors.push("quant source hashes are invalid");
  if (!["fixture", "fixture_market_data_export", "approved_real_historical"].includes(String(value.sourceClassification))) errors.push("quant source classification is invalid");
  if (!["none", "forward", "backward"].includes(String(value.adjustment))) errors.push("quant source adjustment is invalid");
  strictInstant(value.dataCutoff, "quant source dataCutoff", errors);
  strictDate(value.observationStartDate, "quant source observationStartDate", errors);
  strictDate(value.observationEndDate, "quant source observationEndDate", errors);
  if (value.hkConnectUniverse !== undefined && !candidateDiscoveryUniverseIsValid(value.hkConnectUniverse)) {
    errors.push("quant source hkConnectUniverse is invalid");
  }
  if (!Array.isArray(value.universe) || value.universe.length < 2) errors.push("quant source universe requires at least two symbols");
  else {
    const seen = new Set<string>();
    value.universe.forEach((item, index) => {
      if (!isRecord(item)) { errors.push(`quant source universe ${index} is invalid`); return; }
      exactKeys(item, ["market", "code", "symbol", "name", "boardLot"], `quant source universe ${index}`, errors);
      if (item.market !== "HK" || !/^\d{5}$/.test(String(item.code)) || item.symbol !== `HK.${item.code}` || !nonEmptyString(item.name) || !positiveInteger(item.boardLot)) errors.push(`quant source universe ${index} identity is invalid`);
      if (seen.has(String(item.symbol))) errors.push("quant source universe contains duplicate symbols");
      seen.add(String(item.symbol));
    });
  }
  if (!isRecord(value.sourceIdentity)) errors.push("quant sourceIdentity is required");
  else {
    const required = ["source", "classification", "provenance", "authority", "asOf", "fetchedAt", "externalFetch", "sourceKind", "sourcePath", "sourceHash"];
    exactKeysWithOptional(value.sourceIdentity, [...required, "authorizationId"], ["authorizationId"], "quant sourceIdentity", errors);
    for (const field of ["source", "classification", "provenance", "sourceKind", "sourcePath", "sourceHash"]) nonEmpty(value.sourceIdentity[field], `quant sourceIdentity ${field}`, errors);
    if (value.sourceIdentity.authority !== "research_only" || typeof value.sourceIdentity.externalFetch !== "boolean") errors.push("quant sourceIdentity authority is invalid");
    strictInstant(value.sourceIdentity.asOf, "quant sourceIdentity asOf", errors);
    strictInstant(value.sourceIdentity.fetchedAt, "quant sourceIdentity fetchedAt", errors);
  }
}

function validateQuantMethod(value: unknown, errors: string[]): void {
  if (!isRecord(value)) { errors.push("quant method is required"); return; }
  exactKeys(value, ["returnMethod", "annualizationDays", "tailConfidence", "covarianceEstimator", "observationAlignment", "observationCount", "commonTradingDates"], "quant method", errors);
  if (value.returnMethod !== "close_to_close_simple" || value.covarianceEstimator !== "sample_n_minus_1" || value.observationAlignment !== "exact_common_trading_dates") errors.push("quant method is unsupported");
  if (!positiveInteger(value.annualizationDays) || Number(value.annualizationDays) > 366) errors.push("quant annualizationDays is invalid");
  if (!finiteNumber(value.tailConfidence) || Number(value.tailConfidence) < 0.5 || Number(value.tailConfidence) >= 1) errors.push("quant tailConfidence is invalid");
  if (!positiveInteger(value.observationCount) || Number(value.observationCount) < 2) errors.push("quant observationCount is invalid");
  if (!Array.isArray(value.commonTradingDates) || value.commonTradingDates.length !== value.observationCount) errors.push("quant commonTradingDates must match observationCount");
  else value.commonTradingDates.forEach((item, index) => strictDate(item, `quant commonTradingDates ${index}`, errors));
}

function validateQuantStability(value: unknown, method: unknown, errors: string[]): void {
  if (!isRecord(value)) { errors.push("quant stability is required"); return; }
  exactKeys(value, ["status", "minimumStableObservationCount", "observationCount", "limitation"], "quant stability", errors);
  if (!positiveInteger(value.minimumStableObservationCount) || !positiveInteger(value.observationCount)) errors.push("quant stability counts are invalid");
  if (isRecord(method) && value.observationCount !== method.observationCount) errors.push("quant stability observationCount must match method");
  const expected = Number(value.observationCount) >= Number(value.minimumStableObservationCount) ? "sample_threshold_met" : "insufficient_tiny_sample";
  if (value.status !== expected) errors.push("quant stability status must derive from observation threshold");
  nonEmpty(value.limitation, "quant stability limitation", errors);
}

function validateQuantDailyReturns(value: unknown, source: unknown, method: unknown, errors: string[]): void {
  if (!Array.isArray(value) || !isRecord(source) || !isRecord(method)) { errors.push("quant dailyReturns are invalid"); return; }
  const universe = Array.isArray(source.universe) ? source.universe.filter(isRecord) : [];
  if (value.length !== method.observationCount) errors.push("quant dailyReturns must match observationCount");
  value.forEach((row, index) => {
    if (!isRecord(row)) { errors.push(`quant daily return ${index} is invalid`); return; }
    exactKeys(row, ["tradeDate", "values"], `quant daily return ${index}`, errors);
    if (!Array.isArray(method.commonTradingDates) || row.tradeDate !== method.commonTradingDates[index]) errors.push(`quant daily return ${index} date must match method order`);
    if (!Array.isArray(row.values) || row.values.length !== universe.length) { errors.push(`quant daily return ${index} must cover universe`); return; }
    row.values.forEach((item, symbolIndex) => {
      if (!isRecord(item)) { errors.push(`quant daily return ${index}.${symbolIndex} is invalid`); return; }
      exactKeys(item, ["symbol", "previousClose", "close", "volume", "turnover", "value"], `quant daily return ${index}.${symbolIndex}`, errors);
      if (item.symbol !== universe[symbolIndex]?.symbol || !finitePositive(item.previousClose) || !finitePositive(item.close)
        || !finiteNonNegative(item.volume) || !finiteNonNegative(item.turnover)) errors.push(`quant daily return ${index}.${symbolIndex} facts are invalid`);
      if (item.value !== round(Number(item.close) / Number(item.previousClose) - 1, 10)) errors.push(`quant daily return ${index}.${symbolIndex} must recompute from closes`);
    });
  });
}

function validateQuantSeries(value: unknown, daily: unknown, source: unknown, method: unknown, errors: string[]): void {
  if (!Array.isArray(value) || !Array.isArray(daily) || !isRecord(source) || !isRecord(method) || !Array.isArray(source.universe)) { errors.push("quant series are invalid"); return; }
  if (value.length !== source.universe.length) errors.push("quant series must cover universe");
  value.forEach((series, index) => {
    if (!isRecord(series) || !isRecord(source.universe[index])) { errors.push(`quant series ${index} is invalid`); return; }
    exactKeys(series, ["symbol", "boardLot", "annualizedVolatility", "worstDailyReturn", "historicalTailLossMagnitude", "liquidity"], `quant series ${index}`, errors);
    const symbol = source.universe[index].symbol;
    const observations = daily.map((row) => isRecord(row) && Array.isArray(row.values) ? row.values.find((item) => isRecord(item) && item.symbol === symbol) : null).filter(isRecord);
    const returns = observations.map((item) => Number(item.value));
    if (series.symbol !== symbol || series.boardLot !== source.universe[index].boardLot
      || series.annualizedVolatility !== round(sampleStandardDeviation(returns) * Math.sqrt(Number(method.annualizationDays)), 10)
      || series.worstDailyReturn !== round(Math.min(...returns), 10)
      || series.historicalTailLossMagnitude !== round(historicalTailLoss(returns, Number(method.tailConfidence)), 10)) errors.push(`quant series ${index} metrics must recompute`);
    if (!isRecord(series.liquidity)) errors.push(`quant series ${index} liquidity is required`);
    else {
      exactKeys(series.liquidity, ["medianDailyVolume", "medianDailyTurnover", "minimumDailyVolume", "minimumDailyTurnover", "zeroVolumeObservationCount"], `quant series ${index} liquidity`, errors);
      const volumes = observations.map((item) => Number(item.volume));
      const turnovers = observations.map((item) => Number(item.turnover));
      if (series.liquidity.medianDailyVolume !== round(median(volumes), 4)
        || series.liquidity.medianDailyTurnover !== round(median(turnovers), 4)
        || series.liquidity.minimumDailyVolume !== round(Math.min(...volumes), 4)
        || series.liquidity.minimumDailyTurnover !== round(Math.min(...turnovers), 4)
        || series.liquidity.zeroVolumeObservationCount !== volumes.filter((item) => item === 0).length) errors.push(`quant series ${index} liquidity must recompute`);
    }
  });
}

function validateQuantCovariance(value: unknown, daily: unknown, source: unknown, method: unknown, errors: string[]): void {
  if (!Array.isArray(value) || !Array.isArray(daily) || !isRecord(source) || !Array.isArray(source.universe) || !isRecord(method)) { errors.push("quant covariance is invalid"); return; }
  const expectedCount = source.universe.length * (source.universe.length + 1) / 2;
  if (value.length !== expectedCount) errors.push("quant covariance must contain the upper triangle");
  let sourceIndex = 0;
  for (let leftIndex = 0; leftIndex < source.universe.length; leftIndex += 1) {
    for (let rightIndex = leftIndex; rightIndex < source.universe.length; rightIndex += 1) {
      const item = value[sourceIndex++];
      if (!isRecord(item)) { errors.push("quant covariance item is invalid"); continue; }
      exactKeys(item, ["leftSymbol", "rightSymbol", "annualizedCovariance", "correlation"], "quant covariance item", errors);
      const leftSymbol = source.universe[leftIndex].symbol;
      const rightSymbol = source.universe[rightIndex].symbol;
      const left = returnsFor(daily, String(leftSymbol));
      const right = returnsFor(daily, String(rightSymbol));
      const dailyCovariance = sampleCovariance(left, right);
      const denominator = sampleStandardDeviation(left) * sampleStandardDeviation(right);
      const correlation = denominator === 0 ? null : round(dailyCovariance / denominator, 10);
      if (item.leftSymbol !== leftSymbol || item.rightSymbol !== rightSymbol
        || item.annualizedCovariance !== round(dailyCovariance * Number(method.annualizationDays), 12)
        || item.correlation !== correlation) errors.push("quant covariance item must recompute in upper-triangle source order");
    }
  }
}

function validateQuantExecution(value: unknown, source: unknown, errors: string[]): void {
  if (!isRecord(value) || !isRecord(source) || !Array.isArray(source.universe)) { errors.push("quant executionEvidence is invalid"); return; }
  exactKeys(value, ["boardLots", "feeCurrency", "nonZeroCosts", "fees", "signalTiming", "earliestExecution", "allowsSameBarExecution", "allowsMargin"], "quant executionEvidence", errors);
  const expectedLots = source.universe.filter(isRecord).map((item) => ({ symbol: item.symbol, boardLot: item.boardLot }));
  if (!sameCanonical(value.boardLots, expectedLots) || value.feeCurrency !== "HKD" || value.signalTiming !== "after_close_t"
    || value.earliestExecution !== "next_trading_day_open" || value.allowsSameBarExecution !== false || value.allowsMargin !== false) errors.push("quant execution boundaries are invalid");
  if (!isRecord(value.fees)) errors.push("quant fee evidence is required");
  else {
    const fields = ["commissionRate", "minCommission", "platformFee", "stampDutyRate", "tradingFeeRate", "transactionLevyRate"];
    exactKeys(value.fees, fields, "quant fees", errors);
    fields.forEach((field) => { if (!finiteNonNegative(value.fees[field])) errors.push(`quant fee ${field} is invalid`); });
    if (value.nonZeroCosts !== fields.some((field) => Number(value.fees[field]) > 0)) errors.push("quant nonZeroCosts must derive from fee policy");
  }
}

function validateQuantCodeIdentity(value: unknown, errors: string[]): void {
  if (!isRecord(value)) { errors.push("quant codeIdentity is required"); return; }
  exactKeys(value, ["scriptPath", "scriptHash", "configPath", "configHash"], "quant codeIdentity", errors);
  for (const field of ["scriptPath", "configPath"]) nonEmpty(value[field], `quant codeIdentity ${field}`, errors);
  for (const field of ["scriptHash", "configHash"]) if (!/^[a-f0-9]{64}$/i.test(String(value[field]))) errors.push(`quant codeIdentity ${field} is invalid`);
}

function validateQuantAuthority(value: unknown, errors: string[]): void {
  if (!isRecord(value)) { errors.push("quant authority is required"); return; }
  const keys = ["researchOnly", "advisoryOnly", "currentPortfolioFact", "brokerReconciliation", "accountingAuthority", "recommendation", "ranking", "score", "allocation", "sizing", "targetPrice", "tradeDirection", "orderTradeFillAuthority", "cashFeePositionMutation", "brokerWrite", "productionWrite"];
  exactKeys(value, keys, "quant authority", errors);
  if (value.researchOnly !== true || value.advisoryOnly !== true) errors.push("quant authority must remain research-only advisory-only");
  keys.slice(2).forEach((field) => { if (value[field] !== false) errors.push(`quant authority ${field} must be false`); });
}

function validateQuantSafety(value: unknown, errors: string[]): void {
  if (!isRecord(value)) { errors.push("quant safety is required"); return; }
  const keys = ["sendsLiveNetworkRequests", "writesDatabase", "callsBroker", "createsOrder", "createsTrade", "mutatesOfficialPortfolio"];
  exactKeys(value, keys, "quant safety", errors);
  keys.forEach((field) => { if (value[field] !== false) errors.push(`quant safety ${field} must be false`); });
}

function validateLabSafety(value: unknown, errors: string[]): void {
  if (!isRecord(value)) { errors.push("portfolio lab safety is required"); return; }
  const keys = ["advisoryOnly", "userProvidedAmountsOnly", "preservesScenarioOrder", "changesCandidateOrdering", "recommendation", "ranking", "score", "suggestedAmount", "targetWeight", "targetPrice", "tradeDirection", "createsOrder", "createsTrade", "callsBroker", "mutatesOfficialPortfolio", "productionWrite"];
  exactKeys(value, keys, "portfolio lab safety", errors);
  if (value.advisoryOnly !== true || value.userProvidedAmountsOnly !== true || value.preservesScenarioOrder !== true) errors.push("portfolio lab must remain ordered user-input advisory only");
  keys.slice(3).forEach((field) => { if (value[field] !== false) errors.push(`portfolio lab safety ${field} must be false`); });
}

function validateSectorGap(value: unknown, label: string, errors: string[]): void {
  if (!isRecord(value) || value.status !== "not_captured" || value.value !== null || !nonEmptyString(value.limitation)) errors.push(`${label} must remain an explicit not_captured gap`);
  else exactKeys(value, ["status", "value", "limitation"], label, errors);
}

function currentWeightsFromPortfolio(portfolio: unknown): Map<string, number> {
  const positions = isRecord(portfolio) && Array.isArray(portfolio.positions) ? portfolio.positions.filter(isRecord) : [];
  return new Map(positions.map((position) => [String(position.symbol), Number(position.marketWeight)]));
}

function scenarioWeightsFromRisk(portfolio: Record<string, unknown>, risk: Record<string, unknown>, candidateSymbol: string): Map<string, number> {
  const total = isRecord(risk.scenario) ? Number(risk.scenario.totalMarketValue) : Number.NaN;
  const positions = Array.isArray(portfolio.positions) ? portfolio.positions.filter(isRecord) : [];
  const weights = new Map<string, number>();
  positions.filter((position) => position.symbol !== candidateSymbol).forEach((position) => weights.set(String(position.symbol), round(Number(position.marketValue) / total, 8)));
  if (isRecord(risk.scenario)) weights.set(candidateSymbol, Number(risk.scenario.candidateWeight));
  return weights;
}

function candidateRiskContribution(evidence: AnnualPortfolioLabQuantEvidence, weights: Map<string, number>, candidateSymbol: string): number | null {
  const symbols = evidence.source.universe.map((item) => item.symbol);
  const candidateIndex = symbols.indexOf(candidateSymbol);
  if (candidateIndex < 0) return null;
  const matrix = symbols.map((left) => symbols.map((right) => annualizedCovarianceFor(evidence, left, right)));
  const vector = symbols.map((symbol) => weights.get(symbol) ?? 0);
  const marginal = matrix.map((row) => row.reduce((total, covariance, index) => total + covariance * vector[index], 0));
  const variance = vector.reduce((total, weight, index) => total + weight * marginal[index], 0);
  if (!Number.isFinite(variance) || variance <= 0) return null;
  return vector[candidateIndex] * marginal[candidateIndex] / variance;
}

function annualizedCovarianceFor(evidence: AnnualPortfolioLabQuantEvidence, left: string, right: string): number {
  const item = evidence.covariance.find((entry) => (entry.leftSymbol === left && entry.rightSymbol === right) || (entry.leftSymbol === right && entry.rightSymbol === left));
  return item?.annualizedCovariance ?? 0;
}

function correlationFor(evidence: AnnualPortfolioLabQuantEvidence, left: string, right: string): number | null {
  const item = evidence.covariance.find((entry) => (entry.leftSymbol === left && entry.rightSymbol === right) || (entry.leftSymbol === right && entry.rightSymbol === left));
  return item?.correlation ?? null;
}

function unavailableHistorical(status: "not_captured" | "unavailable", limitation: string): AnnualPortfolioHistoricalMetrics {
  return { status, annualizedVolatility: null, historicalStressLossMagnitude: null, historicalStressDate: null, historicalTailLossMagnitude: null, candidateRiskContribution: null, limitation };
}

function sameHistorical(value: unknown, expected: AnnualPortfolioHistoricalMetrics): boolean {
  const expectedRecord = expected as unknown as Record<string, unknown>;
  return isRecord(value) && ["status", "annualizedVolatility", "historicalStressLossMagnitude", "historicalStressDate", "historicalTailLossMagnitude", "candidateRiskContribution", "limitation"].every((field) => value[field] === expectedRecord[field]);
}

function nullableDifference(left: unknown, right: unknown): number | null {
  return finiteNumber(left) && finiteNumber(right) ? round(left - right, 10) : null;
}

function historicalTailLoss(values: number[], confidence: number): number {
  const count = Math.max(1, Math.ceil(values.length * (1 - confidence)));
  return Math.max(0, -mean([...values].sort((left, right) => left - right).slice(0, count)));
}

function sampleCovariance(left: number[], right: number[]): number {
  const leftMean = mean(left);
  const rightMean = mean(right);
  return left.reduce((total, value, index) => total + (value - leftMean) * (right[index] - rightMean), 0) / (left.length - 1);
}

function sampleStandardDeviation(values: number[]): number { return Math.sqrt(sampleCovariance(values, values)); }
function returnsFor(rows: unknown[], symbol: string): number[] { return rows.map((row) => isRecord(row) && Array.isArray(row.values) ? row.values.find((item) => isRecord(item) && item.symbol === symbol) : null).filter(isRecord).map((item) => Number(item.value)); }
function median(values: number[]): number { const sorted = [...values].sort((left, right) => left - right); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function mean(values: number[]): number { return values.reduce((total, value) => total + value, 0) / values.length; }
function unique(values: string[]): string[] { return [...new Set(values)]; }
function round(value: number, digits = 10): number { const factor = 10 ** digits; return Math.round((value + Number.EPSILON) * factor) / factor; }
function sha256(value: string): string { return crypto.createHash("sha256").update(value).digest("hex"); }
function sameCanonical(left: unknown, right: unknown): boolean { return canonicalJson(left) === canonicalJson(right); }
function sameStrings(left: unknown, right: string[]): boolean { return Array.isArray(left) && left.length === right.length && left.every((item, index) => item === right[index]); }
function finiteNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function finitePositive(value: unknown): value is number { return finiteNumber(value) && value > 0; }
function finiteNonNegative(value: unknown): value is number { return finiteNumber(value) && value >= 0; }
function positiveInteger(value: unknown): boolean { return Number.isSafeInteger(value) && Number(value) > 0; }
function nonEmptyString(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function isRecord(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function nonEmpty(value: unknown, label: string, errors: string[]): void { if (!nonEmptyString(value)) errors.push(`${label} must be a non-empty string`); }
function nullableString(value: unknown, label: string, errors: string[]): void { if (value !== null && !nonEmptyString(value)) errors.push(`${label} must be a non-empty string or null`); }
function nullableFinite(value: unknown, label: string, errors: string[]): void { if (value !== null && !finiteNumber(value)) errors.push(`${label} must be finite or null`); }
function strictInstant(value: unknown, label: string, errors: string[]): void { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || new Date(value).toISOString() !== value) errors.push(`${label} must be an ISO UTC instant`); }
function strictDate(value: unknown, label: string, errors: string[]): void { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) errors.push(`${label} must be a calendar date`); }
function boundedStrings(value: unknown, label: string, max: number, errors: string[], allowEmpty = false): void { if (!Array.isArray(value) || value.length > max || (!allowEmpty && value.length === 0) || value.some((item) => !nonEmptyString(item) || item.length > 2_000)) errors.push(`${label} must contain bounded non-empty strings`); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string, errors: string[]): void { const expected = new Set(keys); Object.keys(value).forEach((key) => { if (!expected.has(key)) errors.push(`${label} contains unsupported field ${key}`); }); keys.forEach((key) => { if (!(key in value)) errors.push(`${label} is missing field ${key}`); }); }
function exactKeysWithOptional(value: Record<string, unknown>, keys: readonly string[], optional: readonly string[], label: string, errors: string[]): void { const expected = new Set(keys); const optionalSet = new Set(optional); Object.keys(value).forEach((key) => { if (!expected.has(key)) errors.push(`${label} contains unsupported field ${key}`); }); keys.forEach((key) => { if (!optionalSet.has(key) && !(key in value)) errors.push(`${label} is missing field ${key}`); }); }
