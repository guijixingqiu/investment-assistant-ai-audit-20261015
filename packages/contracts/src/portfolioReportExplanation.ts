import { isRfc3339DateTime } from "./factMetadata.js";
import {
  type AnnualPortfolioHistoricalMetrics,
  type AnnualPortfolioLabQuantView,
  type AnnualPortfolioLabScenario
} from "./annualPortfolioLab.js";
import {
  candidateDiscoveryUniverseIsValid,
  type CandidateDiscoveryUniverse
} from "./marketDiscovery.js";

export const PORTFOLIO_REPORT_EXPLANATION_SCHEMA_VERSION =
  "2026-08-19.portfolio-report-explanation.v2";

export type PortfolioReportExplanationStatus =
  | "available"
  | "blocked"
  | "not_found"
  | "malformed"
  | "unauthorized"
  | "unavailable";

export interface PortfolioReportExplanationData {
  binding: {
    membershipId: string;
    membershipVersion: number;
    membershipState: "tracked" | "paused";
    symbol: string;
    evidencePackId: string;
    evidencePackVersion: number;
    evidencePackFingerprint: string;
    evidencePackActorId: string;
    evidencePackMembershipId: string;
    evidencePackMembershipVersion: number;
    evidencePackSymbol: string;
    reportId: string;
    reportVersion: number;
    reportFingerprint: string;
    reportEvidencePackId: string;
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
      source: "futu";
    };
  };
  holdings: {
    candidate: {
      status: "held" | "not_held";
      marketValue: number;
      weight: number;
    };
    positions: Array<{
      symbol: string;
      name: string | null;
      marketValue: number;
      weight: number;
    }>;
    totalMarketValue: number;
    concentration: {
      largestPositionWeight: number;
      topThreeWeight: number;
      hhi: number;
    };
  };
  scenarios: Array<{
    scenarioId: string;
    userInputAmount: number;
    candidateWeight: number;
    candidateWeightChange: number;
    largestPositionWeight: number;
    largestPositionWeightChange: number;
    hhi: number;
    hhiChange: number;
  }>;
  quantRisk: {
    evidenceId: string;
    hkConnectUniverse: CandidateDiscoveryUniverse;
    source: {
      snapshotId: string;
      snapshotHash: string;
      dataHash: string;
      dataCutoff: string;
      observationStartDate: string;
      observationEndDate: string;
      fetchedAt: string;
    };
    coverage: AnnualPortfolioLabQuantView["coverage"];
    correlations: AnnualPortfolioLabQuantView["correlations"];
    candidateLiquidity: AnnualPortfolioLabQuantView["candidateLiquidity"];
    currentHistorical: AnnualPortfolioHistoricalMetrics;
    scenarios: Array<{
      scenarioId: string;
      historical: AnnualPortfolioLabScenario["historical"];
    }>;
    limitations: string[];
  };
  unknowns: {
    cash: "UNKNOWN";
    fundingSource: "UNKNOWN";
    sector: "UNKNOWN";
    opportunityCost: "UNKNOWN";
  };
}

export interface PortfolioReportExplanationEnvelope {
  schemaVersion: typeof PORTFOLIO_REPORT_EXPLANATION_SCHEMA_VERSION;
  generatedAt: string;
  status: PortfolioReportExplanationStatus;
  membershipId: string;
  requestedActorId: string;
  requestedSymbol: string | null;
  data: PortfolioReportExplanationData | null;
  gaps: string[];
  safety: {
    advisoryOnly: true;
    readOnly: true;
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
    reportWrite: false;
    decisionWrite: false;
    productionWrite: false;
  };
  message: string;
}

export function validatePortfolioReportExplanationEnvelope(
  value: unknown
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return { ok: false, errors: ["portfolio report explanation must be an object"] };
  exact(value, [
    "schemaVersion", "generatedAt", "status", "membershipId", "requestedActorId",
    "requestedSymbol", "data", "gaps", "safety", "message"
  ], "envelope", errors);
  if (value.schemaVersion !== PORTFOLIO_REPORT_EXPLANATION_SCHEMA_VERSION) errors.push("schemaVersion is invalid");
  instant(value.generatedAt, "generatedAt", errors);
  if (!status(value.status)) errors.push("status is invalid");
  nonEmpty(value.membershipId, "membershipId", errors);
  nonEmpty(value.requestedActorId, "requestedActorId", errors);
  if (!Array.isArray(value.gaps) || !value.gaps.every(nonEmptyString)) errors.push("gaps are invalid");
  nonEmpty(value.message, "message", errors);
  validateSafety(value.safety, errors);
  if (value.status === "available") {
    if (!record(value.data)) errors.push("available explanation requires data");
    else validateData(value, value.data, errors);
  } else if (value.data !== null || value.requestedSymbol !== null) {
    errors.push("non-available explanation must clear data and requestedSymbol");
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateData(
  envelope: Record<string, unknown>,
  data: Record<string, unknown>,
  errors: string[]
): void {
  const binding = data.binding;
  const holdings = data.holdings;
  const quantRisk = data.quantRisk;
  const unknowns = data.unknowns;
  exact(data, ["binding", "holdings", "scenarios", "quantRisk", "unknowns"], "data", errors);
  if (!record(binding)) errors.push("binding is required");
  else validateBinding(envelope, binding, errors);
  if (!record(holdings)) errors.push("holdings are required");
  else validateHoldings(binding, holdings, errors);
  if (!Array.isArray(data.scenarios) || data.scenarios.length < 1 || data.scenarios.length > 4) {
    errors.push("scenarios must contain one to four user inputs");
  } else if (record(holdings)) {
    data.scenarios.forEach((scenario, index) => validateScenario(scenario, holdings, index, errors));
  }
  validateQuantRisk(binding, holdings, data.scenarios, quantRisk, errors);
  if (!record(unknowns)) errors.push("unknowns are required");
  else {
    exact(unknowns, ["cash", "fundingSource", "sector", "opportunityCost"], "unknowns", errors);
    if (["cash", "fundingSource", "sector", "opportunityCost"].some((key) => unknowns[key] !== "UNKNOWN")) {
      errors.push("cash, funding source, sector, and opportunity cost must remain UNKNOWN");
    }
  }
}

function validateQuantRisk(
  binding: unknown,
  holdings: unknown,
  scenarios: unknown,
  value: unknown,
  errors: string[]
): void {
  if (!record(value)) { errors.push("quantRisk is required"); return; }
  exact(value, [
    "evidenceId", "hkConnectUniverse", "source", "coverage", "correlations",
    "candidateLiquidity", "currentHistorical", "scenarios", "limitations"
  ], "quantRisk", errors);
  if (typeof value.evidenceId !== "string" || !/^annual-portfolio-lab-quant:[a-f0-9]{64}$/.test(value.evidenceId)) {
    errors.push("quantRisk evidenceId is invalid");
  }
  if (!candidateDiscoveryUniverseIsValid(value.hkConnectUniverse)) errors.push("quantRisk Hong Kong Connect universe is invalid");
  validateQuantRiskSource(value.source, errors);
  const positions = record(holdings) && Array.isArray(holdings.positions) ? holdings.positions.filter(record) : [];
  const targetSymbol = record(binding) ? String(binding.symbol) : "";
  const requiredSymbols = unique([...positions.map((position) => String(position.symbol)), targetSymbol]);
  validateQuantRiskCoverage(value.coverage, requiredSymbols, errors);
  validateQuantRiskCorrelations(value.correlations, value.source, positions, targetSymbol, errors);
  validateQuantRiskLiquidity(value.candidateLiquidity, targetSymbol, errors);
  validateHistorical(value.currentHistorical, "quantRisk currentHistorical", false, errors);
  const quantScenarios = Array.isArray(value.scenarios) ? value.scenarios : [];
  const scenarioIds = Array.isArray(scenarios) ? scenarios.filter(record).map((scenario) => String(scenario.scenarioId)) : [];
  if (!sameStrings(quantScenarios.filter(record).map((scenario) => String(scenario.scenarioId)), scenarioIds)) {
    errors.push("quantRisk scenarios must match requested scenarios");
  }
  quantScenarios.forEach((scenario, index) => {
    if (!record(scenario)) { errors.push(`quantRisk scenario ${index} is invalid`); return; }
    exact(scenario, ["scenarioId", "historical"], `quantRisk scenario ${index}`, errors);
    validateHistorical(scenario.historical, `quantRisk scenario ${index} historical`, true, errors);
  });
  if (!Array.isArray(value.limitations) || !value.limitations.every(nonEmptyString)) errors.push("quantRisk limitations are invalid");
}

function validateQuantRiskSource(value: unknown, errors: string[]): void {
  if (!record(value)) { errors.push("quantRisk source is required"); return; }
  exact(value, [
    "snapshotId", "snapshotHash", "dataHash", "dataCutoff",
    "observationStartDate", "observationEndDate", "fetchedAt"
  ], "quantRisk source", errors);
  nonEmpty(value.snapshotId, "quantRisk source.snapshotId", errors);
  for (const key of ["snapshotHash", "dataHash"] as const) if (!sha(value[key])) errors.push(`quantRisk source.${key} is invalid`);
  instant(value.dataCutoff, "quantRisk source.dataCutoff", errors);
  instant(value.fetchedAt, "quantRisk source.fetchedAt", errors);
  if (!date(value.observationStartDate) || !date(value.observationEndDate)
    || String(value.observationStartDate) > String(value.observationEndDate)) errors.push("quantRisk observation window is invalid");
}

function validateQuantRiskCoverage(value: unknown, requiredSymbols: string[], errors: string[]): void {
  if (!record(value)) { errors.push("quantRisk coverage is required"); return; }
  exact(value, ["status", "requiredSymbols", "coveredSymbols", "missingSymbols", "extraEvidenceSymbols"], "quantRisk coverage", errors);
  if (value.status !== "exact" || !sameStrings(value.requiredSymbols, requiredSymbols)
    || !sameStrings(value.coveredSymbols, requiredSymbols) || !sameStrings(value.missingSymbols, [])) {
    errors.push("quantRisk coverage must be exact for current holdings and target");
  }
}

function validateQuantRiskCorrelations(
  value: unknown,
  source: unknown,
  positions: Record<string, unknown>[],
  targetSymbol: string,
  errors: string[]
): void {
  if (!record(value)) { errors.push("quantRisk correlations are required"); return; }
  exact(value, [
    "status", "observationStartDate", "observationEndDate", "observationCount",
    "stability", "candidateToPositions", "limitation"
  ], "quantRisk correlations", errors);
  const expectedSymbols = positions.map((position) => String(position.symbol)).filter((symbol) => symbol !== targetSymbol);
  const items = Array.isArray(value.candidateToPositions) ? value.candidateToPositions : [];
  if (value.status !== "available" || !record(source)
    || value.observationStartDate !== source.observationStartDate || value.observationEndDate !== source.observationEndDate
    || !Number.isSafeInteger(value.observationCount) || Number(value.observationCount) <= 0
    || !["sample_threshold_met", "insufficient_tiny_sample"].includes(String(value.stability))
    || !sameStrings(items.filter(record).map((item) => String(item.symbol)), expectedSymbols)
    || items.some((item) => !record(item) || item.correlation !== null && (!finite(item.correlation) || Math.abs(item.correlation) > 1))
    || !nonEmptyString(value.limitation)) errors.push("quantRisk correlations are invalid");
}

function validateQuantRiskLiquidity(value: unknown, targetSymbol: string, errors: string[]): void {
  if (!record(value)) { errors.push("quantRisk candidate liquidity is required"); return; }
  exact(value, [
    "status", "symbol", "observationCount", "medianDailyVolume", "medianDailyTurnover",
    "minimumDailyVolume", "minimumDailyTurnover", "zeroVolumeObservationCount", "boardLot",
    "feeCurrency", "nonZeroCosts", "fees", "limitation"
  ], "quantRisk candidate liquidity", errors);
  if (value.status !== "available" || value.symbol !== targetSymbol
    || !Number.isSafeInteger(value.observationCount) || Number(value.observationCount) <= 0
    || !finite(value.medianDailyTurnover) || Number(value.medianDailyTurnover) < 0
    || !Number.isSafeInteger(value.boardLot) || Number(value.boardLot) <= 0
    || value.feeCurrency !== "HKD" || value.nonZeroCosts !== true || !nonEmptyString(value.limitation)) {
    errors.push("quantRisk candidate liquidity is invalid");
  }
}

function validateHistorical(value: unknown, label: string, scenario: boolean, errors: string[]): void {
  if (!record(value)) { errors.push(`${label} is required`); return; }
  const base = [
    "status", "annualizedVolatility", "historicalStressLossMagnitude", "historicalStressDate",
    "historicalTailLossMagnitude", "candidateRiskContribution", "limitation"
  ];
  const changes = [
    "annualizedVolatilityChange", "historicalStressLossChange",
    "historicalTailLossChange", "candidateRiskContributionChange"
  ];
  exact(value, scenario ? [...base, ...changes] : base, label, errors);
  if (value.status !== "available" || !nonEmptyString(value.limitation)
    || !date(value.historicalStressDate)
    || ["annualizedVolatility", "historicalStressLossMagnitude", "historicalTailLossMagnitude"]
      .some((key) => !finite(value[key]) || Number(value[key]) < 0)
    || !finite(value.candidateRiskContribution)
    || scenario && changes.some((key) => !finite(value[key]))) errors.push(`${label} is invalid`);
}

function validateBinding(
  envelope: Record<string, unknown>,
  value: Record<string, unknown>,
  errors: string[]
): void {
  exact(value, [
    "membershipId", "membershipVersion", "membershipState", "symbol", "evidencePackId",
    "evidencePackVersion", "evidencePackFingerprint", "evidencePackActorId",
    "evidencePackMembershipId", "evidencePackMembershipVersion", "evidencePackSymbol",
    "reportId", "reportVersion", "reportFingerprint", "reportEvidencePackId",
    "accountScopeId", "portfolioContextId", "portfolioSnapshotId",
    "portfolioAsOf", "decisionContextId", "decisionContextHash", "quote"
  ], "binding", errors);
  if (value.membershipId !== envelope.membershipId || value.symbol !== envelope.requestedSymbol) {
    errors.push("binding must match envelope membership and symbol");
  }
  if (!positiveInteger(value.membershipId) || !positiveInteger(value.membershipVersion)
    || !["tracked", "paused"].includes(String(value.membershipState))
    || !hkSymbol(value.symbol)) errors.push("membership binding is invalid");
  for (const key of ["evidencePackId", "reportId"]) if (!positiveInteger(value[key])) errors.push(`${key} is invalid`);
  for (const key of ["evidencePackVersion", "reportVersion"]) if (!positiveInteger(value[key])) errors.push(`${key} is invalid`);
  for (const key of ["evidencePackFingerprint", "reportFingerprint", "decisionContextHash"]) {
    if (!sha(value[key])) errors.push(`${key} is invalid`);
  }
  for (const key of ["accountScopeId", "portfolioContextId", "portfolioSnapshotId", "decisionContextId"]) {
    nonEmpty(value[key], key, errors);
  }
  if (value.evidencePackActorId !== envelope.requestedActorId
    || value.evidencePackMembershipId !== value.membershipId
    || value.evidencePackMembershipVersion !== value.membershipVersion
    || value.evidencePackSymbol !== value.symbol
    || value.reportEvidencePackId !== value.evidencePackId) {
    errors.push("actor, evidence pack, report, and membership identities must bind exactly");
  }
  instant(value.portfolioAsOf, "portfolioAsOf", errors);
  if (!record(value.quote)) errors.push("quote binding is required");
  else {
    exact(value.quote, ["snapshotId", "symbol", "currency", "price", "quoteTime", "fetchedAt", "source"], "quote", errors);
    nonEmpty(value.quote.snapshotId, "quote.snapshotId", errors);
    if (value.quote.symbol !== value.symbol || value.quote.currency !== "HKD" || value.quote.source !== "futu"
      || !finitePositive(value.quote.price)) errors.push("quote must be exact current HKD Futu data for the target");
    instant(value.quote.quoteTime, "quote.quoteTime", errors);
    instant(value.quote.fetchedAt, "quote.fetchedAt", errors);
    if (typeof value.quote.quoteTime === "string" && typeof value.quote.fetchedAt === "string"
      && Date.parse(value.quote.quoteTime) > Date.parse(value.quote.fetchedAt)) errors.push("quote chronology is invalid");
  }
}

function validateHoldings(binding: unknown, value: Record<string, unknown>, errors: string[]): void {
  exact(value, ["candidate", "positions", "totalMarketValue", "concentration"], "holdings", errors);
  if (!finitePositive(value.totalMarketValue)) errors.push("totalMarketValue must be positive");
  const positions = Array.isArray(value.positions) ? value.positions : [];
  if (positions.length === 0 || positions.some((position) => !validPosition(position))) errors.push("positions are invalid");
  const valid = positions.filter(record);
  if (new Set(valid.map((position) => position.symbol)).size !== valid.length) errors.push("position symbols must be unique");
  if (finitePositive(value.totalMarketValue)) {
    const total = Number(value.totalMarketValue);
    if (round(valid.reduce((sum, position) => sum + Number(position.marketValue), 0), 2) !== total) errors.push("position values must equal totalMarketValue");
    if (valid.some((position) => round(Number(position.marketValue) / total, 8) !== position.weight)) errors.push("position weights must recompute from market values");
  }
  const symbol = record(binding) ? binding.symbol : null;
  const held = valid.find((position) => position.symbol === symbol);
  if (!record(value.candidate)
    || value.candidate.status !== (held ? "held" : "not_held")
    || value.candidate.marketValue !== (held?.marketValue ?? 0)
    || value.candidate.weight !== (held?.weight ?? 0)) errors.push("candidate holding must match exact positions");
  if (!record(value.concentration)) errors.push("concentration is required");
  else {
    exact(value.concentration, ["largestPositionWeight", "topThreeWeight", "hhi"], "concentration", errors);
    const weights = valid.map((position) => Number(position.weight)).sort((left, right) => right - left);
    if (value.concentration.largestPositionWeight !== round(weights[0] ?? 0, 8)
      || value.concentration.topThreeWeight !== round(weights.slice(0, 3).reduce((sum, weight) => sum + weight, 0), 8)
      || value.concentration.hhi !== round(weights.reduce((sum, weight) => sum + weight ** 2, 0), 8)) {
      errors.push("concentration must recompute from exact position weights");
    }
  }
}

function validateScenario(value: unknown, holdings: Record<string, unknown>, index: number, errors: string[]): void {
  if (!record(value)) { errors.push(`scenario ${index} is invalid`); return; }
  exact(value, [
    "scenarioId", "userInputAmount", "candidateWeight", "candidateWeightChange",
    "largestPositionWeight", "largestPositionWeightChange", "hhi", "hhiChange"
  ], `scenario ${index}`, errors);
  nonEmpty(value.scenarioId, `scenario ${index}.scenarioId`, errors);
  for (const key of ["userInputAmount", "candidateWeight", "candidateWeightChange", "largestPositionWeight", "largestPositionWeightChange", "hhi", "hhiChange"]) {
    if (!finite(value[key])) errors.push(`scenario ${index}.${key} is invalid`);
  }
  if (finite(value.userInputAmount) && Number(value.userInputAmount) < 0) errors.push(`scenario ${index}.userInputAmount is invalid`);
  if (finite(value.userInputAmount) && Number(value.userInputAmount) > 1_000_000_000_000) errors.push(`scenario ${index}.userInputAmount is invalid`);
  for (const key of ["candidateWeight", "largestPositionWeight", "hhi"]) {
    if (finite(value[key]) && (Number(value[key]) < 0 || Number(value[key]) > 1)) errors.push(`scenario ${index}.${key} is invalid`);
  }
  if (!record(holdings.candidate) || !record(holdings.concentration)) return;
  if (round(Number(value.candidateWeight) - Number(holdings.candidate.weight), 8) !== value.candidateWeightChange
    || round(Number(value.largestPositionWeight) - Number(holdings.concentration.largestPositionWeight), 8) !== value.largestPositionWeightChange
    || round(Number(value.hhi) - Number(holdings.concentration.hhi), 8) !== value.hhiChange) {
    errors.push(`scenario ${index} deltas must bind current holdings`);
  }
}

function validateSafety(value: unknown, errors: string[]): void {
  if (!record(value)) { errors.push("safety is required"); return; }
  const truthy = ["advisoryOnly", "readOnly"];
  const falsy = [
    "recommendation", "ranking", "score", "suggestedAmount", "targetWeight", "targetPrice",
    "tradeDirection", "createsOrder", "createsTrade", "callsBroker", "mutatesOfficialPortfolio",
    "reportWrite", "decisionWrite", "productionWrite"
  ];
  exact(value, [...truthy, ...falsy], "safety", errors);
  if (truthy.some((key) => value[key] !== true) || falsy.some((key) => value[key] !== false)) errors.push("safety boundary is invalid");
}

function validPosition(value: unknown): boolean {
  if (!record(value)) return false;
  const errors: string[] = [];
  exact(value, ["symbol", "name", "marketValue", "weight"], "position", errors);
  return errors.length === 0 && hkSymbol(value.symbol)
    && (value.name === null || typeof value.name === "string")
    && finite(value.marketValue) && Number(value.marketValue) >= 0
    && finite(value.weight) && Number(value.weight) >= 0 && Number(value.weight) <= 1;
}

function status(value: unknown): value is PortfolioReportExplanationStatus {
  return ["available", "blocked", "not_found", "malformed", "unauthorized", "unavailable"].includes(String(value));
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function nonEmptyString(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function nonEmpty(value: unknown, label: string, errors: string[]): void { if (!nonEmptyString(value)) errors.push(`${label} is required`); }
function positiveInteger(value: unknown): boolean { return (typeof value === "string" && /^[1-9]\d*$/.test(value)) || (Number.isSafeInteger(value) && Number(value) > 0); }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function finitePositive(value: unknown): value is number { return finite(value) && value > 0; }
function hkSymbol(value: unknown): boolean { return typeof value === "string" && /^HK\.\d{5}$/.test(value); }
function sha(value: unknown): boolean { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function instant(value: unknown, label: string, errors: string[]): void { if (typeof value !== "string" || !isRfc3339DateTime(value)) errors.push(`${label} is invalid`); }
function exact(value: Record<string, unknown>, keys: string[], label: string, errors: string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) errors.push(`${label} keys are invalid`);
}
function date(value: unknown): boolean { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value); }
function unique(values: string[]): string[] { return [...new Set(values)]; }
function sameStrings(value: unknown, expected: string[]): boolean {
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]);
}
function round(value: number, digits: number): number { const factor = 10 ** digits; return Math.round((value + Number.EPSILON) * factor) / factor; }
