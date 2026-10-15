export type {
  AnnualPortfolioHistoricalMetrics,
  AnnualPortfolioLabData,
  AnnualPortfolioLabEnvelope,
  AnnualPortfolioLabQuantEvidence,
  AnnualPortfolioLabQuantView,
  AnnualPortfolioLabScenario,
  AnnualPortfolioLabStatus
} from "./annualPortfolioLab.js";
import type {
  AnnualPortfolioHistoricalMetrics,
  AnnualPortfolioLabEnvelope,
  AnnualPortfolioLabQuantEvidence
} from "./annualPortfolioLab.js";
import { canonicalJson } from "./decisionContextBrowser.js";
import { candidateDiscoveryUniverseIsValid } from "./marketDiscovery.js";
import {
  validatePortfolioDecisionContextForBrowser,
  validatePortfolioRiskImpactBindingForBrowser,
  validatePortfolioRiskImpactForBrowser
} from "./portfolioDecisionContextBrowser.js";
import {
  quantManifestExecutionCalendarIsBounded,
  quantManifestFeePolicyGate
} from "./quantRegisteredResearchRun.js";

export const ANNUAL_PORTFOLIO_LAB_SCHEMA_VERSION = "2026-07-17.annual-portfolio-lab.v1";
export const ANNUAL_PORTFOLIO_LAB_CALCULATION_VERSION = "annual-portfolio-lab.v1";
export const ANNUAL_PORTFOLIO_LAB_QUANT_SCHEMA_VERSION = "2026-07-17.quant-portfolio-lab-evidence.v1";

export async function validateAnnualPortfolioLabForBrowser(value: unknown): Promise<
  | { ok: true; value: AnnualPortfolioLabEnvelope }
  | { ok: false; errors: string[] }
> {
  const errors: string[] = [];
  if (!record(value)) return { ok: false, errors: ["portfolio lab envelope must be an object"] };
  exact(value, ["schemaVersion", "calculationVersion", "generatedAt", "status", "labId", "membershipId", "requestedActorId", "requestedSymbol", "data", "gaps", "safety", "message"], "portfolio lab", errors);
  if (value.schemaVersion !== ANNUAL_PORTFOLIO_LAB_SCHEMA_VERSION || value.calculationVersion !== ANNUAL_PORTFOLIO_LAB_CALCULATION_VERSION) errors.push("portfolio lab contract version is invalid");
  instant(value.generatedAt, "generatedAt", errors);
  if (!["available", "blocked", "not_found", "malformed", "unauthorized", "unavailable"].includes(String(value.status))) errors.push("portfolio lab status is invalid");
  required(value.membershipId, "membershipId", errors);
  required(value.requestedActorId, "requestedActorId", errors);
  strings(value.gaps, "gaps", errors, true);
  required(value.message, "message", errors);
  validateSafety(value.safety, errors);
  if (value.status !== "available") {
    if (value.labId !== null || value.requestedSymbol !== null || value.data !== null) errors.push("non-available portfolio lab must clear labId, requestedSymbol, and data");
    return errors.length === 0
      ? { ok: true, value: value as unknown as AnnualPortfolioLabEnvelope }
      : { ok: false, errors };
  }
  if (!requiredString(value.labId) || typeof value.requestedSymbol !== "string" || !/^HK\.\d{5}$/.test(value.requestedSymbol) || !record(value.data)) {
    errors.push("available portfolio lab requires canonical labId, requestedSymbol, and data");
  } else {
    await validateData(value, value.data, errors);
    const { labId: _labId, generatedAt: _generatedAt, ...identity } = value;
    const expected = `annual-portfolio-lab:${await sha(canonicalJson(identity))}`;
    if (value.labId !== expected) errors.push("portfolio lab labId does not match canonical content");
  }
  return errors.length === 0
    ? { ok: true, value: value as unknown as AnnualPortfolioLabEnvelope }
    : { ok: false, errors };
}

async function validateData(envelope: Record<string, unknown>, data: Record<string, unknown>, errors: string[]): Promise<void> {
  exact(data, ["target", "sourceIdentity", "portfolio", "dimensions", "current", "scenarios", "quant"], "portfolio lab data", errors);
  const target = data.target;
  const source = data.sourceIdentity;
  if (!record(target)) errors.push("portfolio lab target is required");
  else {
    exact(target, ["membershipId", "membershipVersion", "membershipState", "market", "code", "symbol"], "target", errors);
    if (target.membershipId !== envelope.membershipId || target.symbol !== envelope.requestedSymbol || target.market !== "HK" || target.symbol !== `HK.${target.code}` || !positiveInteger(target.membershipVersion) || !["tracked", "paused"].includes(String(target.membershipState))) errors.push("target must bind the envelope membership and canonical symbol");
  }
  if (!record(source)) errors.push("portfolio lab sourceIdentity is required");
  else validateSource(source, target, errors);

  const portfolioValidation = await validatePortfolioDecisionContextForBrowser(data.portfolio);
  if (!portfolioValidation.ok) errors.push(...portfolioValidation.errors.map((error) => `portfolio.${error}`));
  const portfolio = portfolioValidation.ok ? portfolioValidation.value : null;
  if (portfolio && !["available", "stale"].includes(portfolio.status)) errors.push("available portfolio lab requires complete current or explicitly stale portfolio facts");
  if (portfolio && source && record(source) && (portfolio.contextId !== source.portfolioContextId || portfolio.portfolioSnapshotId !== source.portfolioSnapshotId || portfolio.accountScopeId !== source.accountScopeId || portfolio.portfolioAsOf !== source.portfolioAsOf)) errors.push("sourceIdentity must bind the exact current portfolio");
  validateDimensions(data.dimensions, portfolio, target, source, errors);
  validateCurrent(data.current, portfolio, target, errors);
  const evidence = await validateQuant(data.quant, portfolio, target, errors);
  await validateScenarios(data.scenarios, portfolio, target, data.current, data.quant, evidence, errors);
}

function validateSource(value: Record<string, unknown>, target: unknown, errors: string[]): void {
  exact(value, ["accountScopeId", "portfolioContextId", "portfolioSnapshotId", "portfolioAsOf", "decisionContextId", "decisionContextHash", "quote"], "sourceIdentity", errors);
  for (const field of ["accountScopeId", "portfolioContextId", "portfolioSnapshotId", "decisionContextId", "decisionContextHash"]) required(value[field], `sourceIdentity.${field}`, errors);
  instant(value.portfolioAsOf, "sourceIdentity.portfolioAsOf", errors);
  if (!record(value.quote)) errors.push("sourceIdentity.quote is required");
  else {
    exact(value.quote, ["snapshotId", "symbol", "currency", "price", "quoteTime", "fetchedAt", "source"], "sourceIdentity.quote", errors);
    if (!record(target) || value.quote.symbol !== target.symbol || value.quote.currency !== "HKD" || !positive(value.quote.price)) errors.push("sourceIdentity quote must bind a positive candidate HKD quote");
    required(value.quote.snapshotId, "sourceIdentity.quote.snapshotId", errors);
    if (value.quote.source !== "futu") errors.push("sourceIdentity.quote.source must be futu");
    instant(value.quote.quoteTime, "sourceIdentity.quote.quoteTime", errors);
    instant(value.quote.fetchedAt, "sourceIdentity.quote.fetchedAt", errors);
  }
}
function validateDimensions(value: unknown, portfolio: AnnualPortfolioLabEnvelope["data"] extends infer _ ? any : never, target: unknown, source: unknown, errors: string[]): void {
  if (!record(value) || !portfolio || !record(target)) { errors.push("portfolio lab dimensions cannot be validated without bound facts"); return; }
  exact(value, ["positions", "candidate", "currency"], "dimensions", errors);
  if (!Array.isArray(value.positions) || value.positions.length !== portfolio.positions.length) errors.push("dimension positions must cover current portfolio");
  else value.positions.forEach((item, index) => {
    if (!record(item)) { errors.push(`dimension position ${index} is invalid`); return; }
    exact(item, ["sourceIndex", "symbol", "name", "currency", "marketValue", "marketWeight", "sector"], `dimension position ${index}`, errors);
    const position = portfolio.positions[index];
    if (item.sourceIndex !== index || item.symbol !== position.symbol || item.name !== position.name || item.currency !== "HKD" || item.marketValue !== position.marketValue || item.marketWeight !== position.marketWeight) errors.push(`dimension position ${index} must bind source order`);
    sectorGap(item.sector, `dimension position ${index} sector`, errors);
  });
  if (!record(value.candidate)) errors.push("candidate dimension is required");
  else {
    exact(value.candidate, ["symbol", "name", "currency", "currentlyHeld", "sector"], "candidate dimension", errors);
    if (value.candidate.symbol !== target.symbol || value.candidate.currency !== "HKD" || value.candidate.currentlyHeld !== portfolio.positions.some((position: any) => position.symbol === target.symbol)) errors.push("candidate dimension must bind target and current holdings");
    sectorGap(value.candidate.sector, "candidate sector", errors);
  }
  if (!record(value.currency)) errors.push("currency dimension is required");
  else {
    exact(value.currency, ["status", "currencies", "marketValueByCurrency"], "currency dimension", errors);
    const rows = value.currency.marketValueByCurrency;
    if (value.currency.status !== "single_currency" || !same(value.currency.currencies, ["HKD"]) || !Array.isArray(rows) || rows.length !== 1 || !record(rows[0]) || rows[0].currency !== "HKD" || rows[0].marketValue !== portfolio.summary.marketValue.amount || rows[0].weight !== 1) errors.push("currency dimension must bind one complete HKD portfolio");
  }
  void source;
}

function validateCurrent(value: unknown, portfolio: any, target: unknown, errors: string[]): void {
  if (!record(value) || !portfolio || !record(target)) { errors.push("current baseline is required"); return; }
  exact(value, ["totalMarketValue", "candidateMarketValue", "candidateWeight", "largestPositionWeight", "hhi", "historical"], "current baseline", errors);
  const candidate = portfolio.positions.find((position: any) => position.symbol === target.symbol);
  if (value.totalMarketValue !== portfolio.summary.marketValue.amount || value.candidateMarketValue !== (candidate?.marketValue ?? 0) || value.candidateWeight !== (candidate?.marketWeight ?? 0) || value.largestPositionWeight !== portfolio.summary.concentration.largestPositionWeight || value.hhi !== portfolio.summary.concentration.hhi) errors.push("current baseline must bind current portfolio calculations");
  historicalShape(value.historical, "current historical", errors, false);
}

async function validateQuant(value: unknown, portfolio: any, target: unknown, errors: string[]): Promise<AnnualPortfolioLabQuantEvidence | null> {
  if (!record(value) || !portfolio || !record(target)) { errors.push("quant view is required"); return null; }
  exact(value, ["evidenceStatus", "evidence", "coverage", "correlations", "candidateLiquidity", "limitations"], "quant view", errors);
  if (!["available", "missing", "malformed", "unavailable"].includes(String(value.evidenceStatus))) errors.push("quant evidenceStatus is invalid");
  const evidence = value.evidence === null ? null : await validateQuantEvidence(value.evidence, errors);
  if ((evidence && value.evidenceStatus !== "available") || (!evidence && value.evidenceStatus === "available")) errors.push("quant evidence availability must match evidenceStatus");
  const requiredSymbols = unique([...portfolio.positions.map((position: any) => position.symbol), String(target.symbol)]);
  const universe = evidence?.source.universe.map((item) => item.symbol) ?? [];
  const covered = requiredSymbols.filter((symbol) => universe.includes(symbol));
  const missing = requiredSymbols.filter((symbol) => !universe.includes(symbol));
  const extra = universe.filter((symbol) => !requiredSymbols.includes(symbol));
  const coverageStatus = !evidence ? "unavailable" : missing.length === 0 ? "exact" : "incomplete";
  if (!record(value.coverage)) errors.push("quant coverage is required");
  else {
    exact(value.coverage, ["status", "requiredSymbols", "coveredSymbols", "missingSymbols", "extraEvidenceSymbols"], "quant coverage", errors);
    if (value.coverage.status !== coverageStatus || !same(value.coverage.requiredSymbols, requiredSymbols) || !same(value.coverage.coveredSymbols, covered) || !same(value.coverage.missingSymbols, missing) || !same(value.coverage.extraEvidenceSymbols, extra)) errors.push("quant coverage must derive from exact portfolio and candidate symbols");
  }
  validateCorrelations(value.correlations, coverageStatus, evidence, portfolio, target, errors);
  validateLiquidity(value.candidateLiquidity, evidence, String(target.symbol), errors);
  strings(value.limitations, "quant limitations", errors);
  if (coverageStatus === "exact" && evidence && record((portfolio as any)) && record((value as any))) {
    const weights = new Map<string, number>(portfolio.positions.map((position: any) => [position.symbol, position.marketWeight]));
    const expected = historicalMetrics(evidence, weights, String(target.symbol));
    void expected;
  }
  return evidence;
}

async function validateQuantEvidence(value: unknown, errors: string[]): Promise<AnnualPortfolioLabQuantEvidence | null> {
  if (!record(value)) { errors.push("quant evidence must be an object"); return null; }
  exact(value, ["schemaVersion", "generatedAt", "feePolicyVersion", "feePolicySha256", "executionCalendar", "source", "method", "stability", "dailyReturns", "series", "covariance", "executionEvidence", "codeIdentity", "authority", "limitations", "safety", "evidenceId"], "quant evidence", errors);
  if (value.schemaVersion !== ANNUAL_PORTFOLIO_LAB_QUANT_SCHEMA_VERSION) errors.push("quant evidence schemaVersion is invalid");
  instant(value.generatedAt, "quant evidence generatedAt", errors);
  if (!quantManifestFeePolicyGate(value).ok) errors.push("quant evidence fee policy identity is invalid");
  if (!quantManifestExecutionCalendarIsBounded(value)) errors.push("quant evidence execution calendar is invalid");
  if (record(value.executionCalendar)) exact(value.executionCalendar,
    ["timing", "calendarCompleteness"], "quant evidence execution calendar", errors);
  if (!record(value.source) || !record(value.method) || !record(value.stability)) { errors.push("quant evidence source, method, and stability are required"); return null; }
  exact(value.source, ["snapshotId", "snapshotHash", "dataHash", "sourceClassification", "adjustment", "dataCutoff", "observationStartDate", "observationEndDate", ...(value.source.hkConnectUniverse === undefined ? [] : ["hkConnectUniverse"]), "universe", "sourceIdentity"], "quant source", errors);
  exact(value.method, ["returnMethod", "annualizationDays", "tailConfidence", "covarianceEstimator", "observationAlignment", "observationCount", "commonTradingDates"], "quant method", errors);
  exact(value.stability, ["status", "minimumStableObservationCount", "observationCount", "limitation"], "quant stability", errors);
  if (!requiredString(value.source.snapshotId) || !hash(value.source.snapshotHash) || !hash(value.source.dataHash) || !["fixture", "fixture_market_data_export", "approved_real_historical"].includes(String(value.source.sourceClassification)) || !["none", "forward", "backward"].includes(String(value.source.adjustment))) errors.push("quant source identity is invalid");
  instant(value.source.dataCutoff, "quant source dataCutoff", errors);
  date(value.source.observationStartDate, "quant source observationStartDate", errors);
  date(value.source.observationEndDate, "quant source observationEndDate", errors);
  if (value.source.hkConnectUniverse !== undefined && !candidateDiscoveryUniverseIsValid(value.source.hkConnectUniverse)) errors.push("quant source hkConnectUniverse is invalid");
  if (!Array.isArray(value.source.universe) || value.source.universe.length < 2) errors.push("quant universe requires at least two symbols");
  else value.source.universe.forEach((item, index) => {
    if (!record(item)) { errors.push(`quant universe ${index} is invalid`); return; }
    exact(item, ["market", "code", "symbol", "name", "boardLot"], `quant universe ${index}`, errors);
    if (item.market !== "HK" || item.symbol !== `HK.${item.code}` || !positiveInteger(item.boardLot)) errors.push(`quant universe ${index} identity is invalid`);
  });
  if (value.method.returnMethod !== "close_to_close_simple" || value.method.covarianceEstimator !== "sample_n_minus_1" || value.method.observationAlignment !== "exact_common_trading_dates" || !positiveInteger(value.method.annualizationDays) || !positiveInteger(value.method.observationCount) || !finite(value.method.tailConfidence)) errors.push("quant method is invalid");
  if (value.stability.observationCount !== value.method.observationCount || value.stability.status !== (Number(value.stability.observationCount) >= Number(value.stability.minimumStableObservationCount) ? "sample_threshold_met" : "insufficient_tiny_sample")) errors.push("quant stability must derive from observation threshold");
  validateDailyReturns(value.dailyReturns, value.source, value.method, errors);
  validateSeries(value.series, value.dailyReturns, value.source, value.method, errors);
  validateCovariance(value.covariance, value.dailyReturns, value.source, value.method, errors);
  validateExecution(value.executionEvidence, value.source, errors);
  validateFalseAuthority(value.authority, ["currentPortfolioFact", "brokerReconciliation", "accountingAuthority", "recommendation", "ranking", "score", "allocation", "sizing", "targetPrice", "tradeDirection", "orderTradeFillAuthority", "cashFeePositionMutation", "brokerWrite", "productionWrite"], errors);
  if (!record(value.authority) || value.authority.researchOnly !== true || value.authority.advisoryOnly !== true) errors.push("quant evidence must remain research-only and advisory-only");
  validateFalseAuthority(value.safety, ["sendsLiveNetworkRequests", "writesDatabase", "callsBroker", "createsOrder", "createsTrade", "mutatesOfficialPortfolio"], errors);
  strings(value.limitations, "quant evidence limitations", errors);
  if (!requiredString(value.evidenceId)) errors.push("quant evidenceId is required");
  else {
    const { evidenceId: _evidenceId, ...identity } = value;
    if (value.evidenceId !== `annual-portfolio-lab-quant:${await sha(canonicalJson(identity))}`) errors.push("quant evidenceId does not match canonical content");
  }
  return value as unknown as AnnualPortfolioLabQuantEvidence;
}

function validateDailyReturns(value: unknown, source: Record<string, unknown>, method: Record<string, unknown>, errors: string[]): void {
  const universe = Array.isArray(source.universe) ? source.universe.filter(record) : [];
  const dates = Array.isArray(method.commonTradingDates) ? method.commonTradingDates : null;
  if (!Array.isArray(value) || value.length !== method.observationCount || !dates) { errors.push("quant dailyReturns must match observationCount"); return; }
  value.forEach((row, index) => {
    if (!record(row)) { errors.push(`quant daily return ${index} is invalid`); return; }
    exact(row, ["tradeDate", "values"], `quant daily return ${index}`, errors);
    if (row.tradeDate !== dates[index] || !Array.isArray(row.values) || row.values.length !== universe.length) errors.push(`quant daily return ${index} must bind date and universe order`);
    else row.values.forEach((item, symbolIndex) => {
      if (!record(item)) { errors.push(`quant daily return ${index}.${symbolIndex} is invalid`); return; }
      exact(item, ["symbol", "previousClose", "close", "volume", "turnover", "value"], `quant daily return ${index}.${symbolIndex}`, errors);
      if (item.symbol !== universe[symbolIndex].symbol || !positive(item.previousClose) || !positive(item.close) || !nonNegative(item.volume) || !nonNegative(item.turnover) || item.value !== round(Number(item.close) / Number(item.previousClose) - 1, 10)) errors.push(`quant daily return ${index}.${symbolIndex} must recompute from source-order closes`);
    });
  });
}

function validateSeries(value: unknown, daily: unknown, source: Record<string, unknown>, method: Record<string, unknown>, errors: string[]): void {
  const universe = Array.isArray(source.universe) ? source.universe.filter(record) : [];
  if (!Array.isArray(value) || !Array.isArray(daily) || value.length !== universe.length) { errors.push("quant series must cover universe"); return; }
  value.forEach((series, index) => {
    if (!record(series)) { errors.push(`quant series ${index} is invalid`); return; }
    exact(series, ["symbol", "boardLot", "annualizedVolatility", "worstDailyReturn", "historicalTailLossMagnitude", "liquidity"], `quant series ${index}`, errors);
    const observations = observationsFor(daily, String(universe[index].symbol));
    const returns = observations.map((item) => Number(item.value));
    if (series.symbol !== universe[index].symbol || series.boardLot !== universe[index].boardLot || series.annualizedVolatility !== round(std(returns) * Math.sqrt(Number(method.annualizationDays)), 10) || series.worstDailyReturn !== round(Math.min(...returns), 10) || series.historicalTailLossMagnitude !== round(tailLoss(returns, Number(method.tailConfidence)), 10)) errors.push(`quant series ${index} must recompute`);
    if (!record(series.liquidity)) errors.push(`quant series ${index} liquidity is required`);
    else {
      exact(series.liquidity, ["medianDailyVolume", "medianDailyTurnover", "minimumDailyVolume", "minimumDailyTurnover", "zeroVolumeObservationCount"], `quant series ${index} liquidity`, errors);
      const volumes = observations.map((item) => Number(item.volume));
      const turnovers = observations.map((item) => Number(item.turnover));
      if (series.liquidity.medianDailyVolume !== round(median(volumes), 4) || series.liquidity.medianDailyTurnover !== round(median(turnovers), 4) || series.liquidity.minimumDailyVolume !== round(Math.min(...volumes), 4) || series.liquidity.minimumDailyTurnover !== round(Math.min(...turnovers), 4) || series.liquidity.zeroVolumeObservationCount !== volumes.filter((item) => item === 0).length) errors.push(`quant series ${index} liquidity must recompute`);
    }
  });
}

function validateCovariance(value: unknown, daily: unknown, source: Record<string, unknown>, method: Record<string, unknown>, errors: string[]): void {
  const universe = Array.isArray(source.universe) ? source.universe.filter(record) : [];
  if (!Array.isArray(value) || !Array.isArray(daily) || value.length !== universe.length * (universe.length + 1) / 2) { errors.push("quant covariance upper triangle is invalid"); return; }
  let index = 0;
  for (let leftIndex = 0; leftIndex < universe.length; leftIndex += 1) for (let rightIndex = leftIndex; rightIndex < universe.length; rightIndex += 1) {
    const item = value[index++];
    if (!record(item)) { errors.push("quant covariance item is invalid"); continue; }
    exact(item, ["leftSymbol", "rightSymbol", "annualizedCovariance", "correlation"], "quant covariance item", errors);
    const leftSymbol = String(universe[leftIndex].symbol);
    const rightSymbol = String(universe[rightIndex].symbol);
    const left = observationsFor(daily, leftSymbol).map((row) => Number(row.value));
    const right = observationsFor(daily, rightSymbol).map((row) => Number(row.value));
    const covariance = cov(left, right);
    const denominator = std(left) * std(right);
    const correlation = denominator === 0 ? null : round(covariance / denominator, 10);
    if (item.leftSymbol !== leftSymbol || item.rightSymbol !== rightSymbol || item.annualizedCovariance !== round(covariance * Number(method.annualizationDays), 12) || item.correlation !== correlation) errors.push("quant covariance must recompute in upper-triangle source order");
  }
}

function validateExecution(value: unknown, source: Record<string, unknown>, errors: string[]): void {
  if (!record(value)) { errors.push("quant executionEvidence is required"); return; }
  exact(value, ["boardLots", "feeCurrency", "nonZeroCosts", "fees", "signalTiming", "earliestExecution", "allowsSameBarExecution", "allowsMargin"], "quant executionEvidence", errors);
  const universe = Array.isArray(source.universe) ? source.universe.filter(record) : [];
  if (!same(value.boardLots, universe.map((item) => ({ symbol: item.symbol, boardLot: item.boardLot }))) || value.feeCurrency !== "HKD" || value.signalTiming !== "after_close_t" || value.earliestExecution !== "next_trading_day_open" || value.allowsSameBarExecution !== false || value.allowsMargin !== false || !record(value.fees)) errors.push("quant execution evidence is invalid");
  else {
    const feeFields = ["commissionRate", "minCommission", "platformFee", "stampDutyRate", "tradingFeeRate", "transactionLevyRate"];
    exact(value.fees, feeFields, "quant fees", errors);
    if (feeFields.some((field) => !nonNegative(value.fees[field])) || value.nonZeroCosts !== feeFields.some((field) => Number(value.fees[field]) > 0)) errors.push("quant fees and nonZeroCosts are invalid");
  }
}

function validateCorrelations(value: unknown, coverage: string, evidence: AnnualPortfolioLabQuantEvidence | null, portfolio: any, target: unknown, errors: string[]): void {
  if (!record(value) || !record(target)) { errors.push("quant correlations are required"); return; }
  exact(value, ["status", "observationStartDate", "observationEndDate", "observationCount", "stability", "candidateToPositions", "limitation"], "quant correlations", errors);
  const available = coverage === "exact" && evidence;
  if (!available) {
    if (value.status !== (evidence ? "not_captured" : "unavailable") || value.observationStartDate !== null || value.observationEndDate !== null || value.observationCount !== null || value.stability !== "unavailable" || !same(value.candidateToPositions, [])) errors.push("non-available correlations must clear metrics");
  } else {
    const expected = portfolio.positions.filter((position: any) => position.symbol !== target.symbol).map((position: any) => ({ symbol: position.symbol, correlation: correlationFor(evidence, String(target.symbol), position.symbol) }));
    if (value.status !== "available" || value.observationStartDate !== evidence.source.observationStartDate || value.observationEndDate !== evidence.source.observationEndDate || value.observationCount !== evidence.method.observationCount || value.stability !== evidence.stability.status || !same(value.candidateToPositions, expected)) errors.push("correlations must bind canonical evidence and portfolio source order");
  }
  required(value.limitation, "correlation limitation", errors);
}

function validateLiquidity(value: unknown, evidence: AnnualPortfolioLabQuantEvidence | null, symbol: string, errors: string[]): void {
  if (!record(value)) { errors.push("candidate liquidity is required"); return; }
  exact(value, ["status", "symbol", "observationCount", "medianDailyVolume", "medianDailyTurnover", "minimumDailyVolume", "minimumDailyTurnover", "zeroVolumeObservationCount", "boardLot", "feeCurrency", "nonZeroCosts", "fees", "limitation"], "candidate liquidity", errors);
  const series = evidence?.series.find((item) => item.symbol === symbol) ?? null;
  if (value.symbol !== symbol || value.status !== (series ? "available" : evidence ? "not_captured" : "unavailable")) errors.push("candidate liquidity status and symbol are invalid");
  if (!series || !evidence) {
    for (const field of ["observationCount", "medianDailyVolume", "medianDailyTurnover", "minimumDailyVolume", "minimumDailyTurnover", "zeroVolumeObservationCount", "boardLot", "feeCurrency", "nonZeroCosts", "fees"]) if (value[field] !== null) errors.push(`non-available candidate liquidity must clear ${field}`);
  } else if (value.observationCount !== evidence.method.observationCount || value.medianDailyVolume !== series.liquidity.medianDailyVolume || value.medianDailyTurnover !== series.liquidity.medianDailyTurnover || value.minimumDailyVolume !== series.liquidity.minimumDailyVolume || value.minimumDailyTurnover !== series.liquidity.minimumDailyTurnover || value.zeroVolumeObservationCount !== series.liquidity.zeroVolumeObservationCount || value.boardLot !== series.boardLot || value.feeCurrency !== evidence.executionEvidence.feeCurrency || value.nonZeroCosts !== evidence.executionEvidence.nonZeroCosts || !same(value.fees, evidence.executionEvidence.fees)) errors.push("candidate liquidity must bind exact evidence");
  required(value.limitation, "candidate liquidity limitation", errors);
}

async function validateScenarios(value: unknown, portfolio: any, target: unknown, current: unknown, quant: unknown, evidence: AnnualPortfolioLabQuantEvidence | null, errors: string[]): Promise<void> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4 || !portfolio || !record(target) || !record(current) || !record(quant)) { errors.push("portfolio lab scenarios must contain one to four bound entries"); return; }
  for (const [index, scenario] of value.entries()) {
    if (!record(scenario)) { errors.push(`scenario ${index} is invalid`); continue; }
    exact(scenario, ["sourceIndex", "scenarioId", "hypotheticalAmount", "riskImpact", "comparison", "historical"], `scenario ${index}`, errors);
    if (scenario.sourceIndex !== index || !nonNegative(scenario.hypotheticalAmount)) errors.push(`scenario ${index} must preserve user order and amount`);
    const riskValidation = await validatePortfolioRiskImpactForBrowser(scenario.riskImpact);
    if (!riskValidation.ok) errors.push(...riskValidation.errors.map((error) => `scenario ${index}.${error}`));
    else {
      const binding = validatePortfolioRiskImpactBindingForBrowser(riskValidation.value, portfolio, String(target.symbol), Number(scenario.hypotheticalAmount), { allowStaleReadOnly: true });
      if (!binding.ok) errors.push(...binding.errors.map((error) => `scenario ${index}.${error}`));
    }
    validateComparison(scenario.comparison, portfolio, target, current, scenario.riskImpact, `scenario ${index}`, errors);
    const exactCoverage = record(quant.coverage) && quant.coverage.status === "exact" && evidence;
    const expectedHistorical = exactCoverage && record(scenario.riskImpact)
      ? historicalMetrics(evidence, scenarioWeights(portfolio, scenario.riskImpact, String(target.symbol)), String(target.symbol))
      : null;
    validateScenarioHistorical(scenario.historical, expectedHistorical, current.historical, `scenario ${index}`, errors);
    if (!requiredString(scenario.scenarioId)) errors.push(`scenario ${index} scenarioId is required`);
    else {
      const { scenarioId: _scenarioId, ...identity } = scenario;
      if (scenario.scenarioId !== `annual-portfolio-scenario:${await sha(canonicalJson(identity))}`) errors.push(`scenario ${index} scenarioId does not match canonical content`);
    }
  }
  if (record(quant.coverage) && quant.coverage.status === "exact" && evidence) {
    const expectedCurrent = historicalMetrics(evidence, new Map(portfolio.positions.map((position: any) => [position.symbol, position.marketWeight])), String(target.symbol));
    if (!sameHistorical(current.historical, expectedCurrent)) errors.push("current historical metrics must recompute from exact evidence");
  }
}

function validateComparison(value: unknown, portfolio: any, target: Record<string, unknown>, current: Record<string, unknown>, risk: unknown, label: string, errors: string[]): void {
  if (!record(value) || !record(risk) || !record(risk.scenario)) { errors.push(`${label} comparison is required`); return; }
  exact(value, ["candidateWeightChange", "largestPositionWeightChange", "hhiChange", "otherPositionWeightChanges", "fundingSourceStatus", "cashStatus", "opportunityCostLimitation"], `${label} comparison`, errors);
  const expected = portfolio.positions.filter((position: any) => position.symbol !== target.symbol).map((position: any) => {
    const scenarioWeight = round(position.marketValue / risk.scenario.totalMarketValue, 8);
    return { symbol: position.symbol, currentWeight: position.marketWeight, scenarioWeight, weightChange: round(scenarioWeight - position.marketWeight, 8) };
  });
  if (value.candidateWeightChange !== risk.scenario.weightChange || value.largestPositionWeightChange !== round(Number(risk.scenario.largestPositionWeight) - Number(current.largestPositionWeight), 8) || value.hhiChange !== round(Number(risk.scenario.hhi) - Number(current.hhi), 8) || !same(value.otherPositionWeightChanges, expected) || value.fundingSourceStatus !== "not_captured" || value.cashStatus !== "unknown" || !requiredString(value.opportunityCostLimitation)) errors.push(`${label} comparison must recompute and keep funding/cash unknown`);
}

function validateScenarioHistorical(value: unknown, expected: AnnualPortfolioHistoricalMetrics | null, current: unknown, label: string, errors: string[]): void {
  historicalShape(value, `${label} historical`, errors, true);
  if (!record(value)) return;
  if (!expected) {
    for (const field of ["annualizedVolatilityChange", "historicalStressLossChange", "historicalTailLossChange", "candidateRiskContributionChange"]) if (value[field] !== null) errors.push(`${label} non-available historical changes must be null`);
    return;
  }
  if (!record(current) || !sameHistorical(value, expected) || value.annualizedVolatilityChange !== difference(expected.annualizedVolatility, current.annualizedVolatility) || value.historicalStressLossChange !== difference(expected.historicalStressLossMagnitude, current.historicalStressLossMagnitude) || value.historicalTailLossChange !== difference(expected.historicalTailLossMagnitude, current.historicalTailLossMagnitude) || value.candidateRiskContributionChange !== difference(expected.candidateRiskContribution, current.candidateRiskContribution)) errors.push(`${label} historical metrics and deltas must recompute`);
}

function historicalMetrics(evidence: AnnualPortfolioLabQuantEvidence, weights: Map<string, number>, candidateSymbol: string): AnnualPortfolioHistoricalMetrics {
  const rows = evidence.dailyReturns.map((row) => ({ tradeDate: row.tradeDate, value: row.values.reduce((sum, item) => sum + (weights.get(item.symbol) ?? 0) * item.value, 0) }));
  const values = rows.map((row) => row.value);
  const worst = [...rows].sort((left, right) => left.value - right.value || left.tradeDate.localeCompare(right.tradeDate))[0];
  return {
    status: "available",
    annualizedVolatility: round(std(values) * Math.sqrt(evidence.method.annualizationDays), 10),
    historicalStressLossMagnitude: round(Math.max(0, -worst.value), 10),
    historicalStressDate: worst.tradeDate,
    historicalTailLossMagnitude: round(tailLoss(values, evidence.method.tailConfidence), 10),
    candidateRiskContribution: riskContribution(evidence, weights, candidateSymbol),
    limitation: "Historical metrics use the exact canonical quant window and current fact weights as research evidence only."
  };
}

function riskContribution(evidence: AnnualPortfolioLabQuantEvidence, weights: Map<string, number>, candidate: string): number | null {
  const symbols = evidence.source.universe.map((item) => item.symbol);
  const candidateIndex = symbols.indexOf(candidate);
  if (candidateIndex < 0) return null;
  const vector = symbols.map((symbol) => weights.get(symbol) ?? 0);
  const marginal = symbols.map((left) => symbols.reduce((sum, right, index) => sum + covarianceFor(evidence, left, right) * vector[index], 0));
  const variance = vector.reduce((sum, weight, index) => sum + weight * marginal[index], 0);
  return variance > 0 ? round(vector[candidateIndex] * marginal[candidateIndex] / variance, 10) : null;
}

function scenarioWeights(portfolio: any, risk: Record<string, unknown>, candidate: string): Map<string, number> {
  const scenario = record(risk.scenario) ? risk.scenario : {};
  const total = Number(scenario.totalMarketValue);
  const weights = new Map<string, number>();
  portfolio.positions.filter((position: any) => position.symbol !== candidate).forEach((position: any) => weights.set(position.symbol, round(position.marketValue / total, 8)));
  weights.set(candidate, Number(scenario.candidateWeight));
  return weights;
}

function historicalShape(value: unknown, label: string, errors: string[], changes: boolean): void {
  if (!record(value)) { errors.push(`${label} is required`); return; }
  const base = ["status", "annualizedVolatility", "historicalStressLossMagnitude", "historicalStressDate", "historicalTailLossMagnitude", "candidateRiskContribution", "limitation"];
  exact(value, changes ? [...base, "annualizedVolatilityChange", "historicalStressLossChange", "historicalTailLossChange", "candidateRiskContributionChange"] : base, label, errors);
  if (!["available", "not_captured", "unavailable"].includes(String(value.status)) || !requiredString(value.limitation)) errors.push(`${label} status or limitation is invalid`);
  for (const field of ["annualizedVolatility", "historicalStressLossMagnitude", "historicalTailLossMagnitude", "candidateRiskContribution", ...(changes ? ["annualizedVolatilityChange", "historicalStressLossChange", "historicalTailLossChange", "candidateRiskContributionChange"] : [])]) if (value[field] !== null && !finite(value[field])) errors.push(`${label}.${field} must be finite or null`);
  if (value.historicalStressDate !== null) date(value.historicalStressDate, `${label}.historicalStressDate`, errors);
  if (value.status !== "available" && base.slice(1, 6).some((field) => value[field] !== null)) errors.push(`${label} non-available state must clear metrics`);
}

function validateSafety(value: unknown, errors: string[]): void {
  if (!record(value)) { errors.push("portfolio lab safety is required"); return; }
  const keys = ["advisoryOnly", "userProvidedAmountsOnly", "preservesScenarioOrder", "changesCandidateOrdering", "recommendation", "ranking", "score", "suggestedAmount", "targetWeight", "targetPrice", "tradeDirection", "createsOrder", "createsTrade", "callsBroker", "mutatesOfficialPortfolio", "productionWrite"];
  exact(value, keys, "portfolio lab safety", errors);
  if (value.advisoryOnly !== true || value.userProvidedAmountsOnly !== true || value.preservesScenarioOrder !== true || keys.slice(3).some((field) => value[field] !== false)) errors.push("portfolio lab safety boundary is invalid");
}

function validateFalseAuthority(value: unknown, fields: string[], errors: string[]): void { if (!record(value) || fields.some((field) => value[field] !== false)) errors.push(`unsafe authority or safety fields: ${fields.join(", ")}`); }
function sectorGap(value: unknown, label: string, errors: string[]): void { if (!record(value) || value.status !== "not_captured" || value.value !== null || !requiredString(value.limitation)) errors.push(`${label} must remain an explicit gap`); else exact(value, ["status", "value", "limitation"], label, errors); }
function correlationFor(evidence: AnnualPortfolioLabQuantEvidence, left: string, right: string): number | null { return evidence.covariance.find((item) => (item.leftSymbol === left && item.rightSymbol === right) || (item.leftSymbol === right && item.rightSymbol === left))?.correlation ?? null; }
function covarianceFor(evidence: AnnualPortfolioLabQuantEvidence, left: string, right: string): number { return evidence.covariance.find((item) => (item.leftSymbol === left && item.rightSymbol === right) || (item.leftSymbol === right && item.rightSymbol === left))?.annualizedCovariance ?? 0; }
function observationsFor(rows: unknown[], symbol: string): Record<string, unknown>[] { return rows.map((row) => record(row) && Array.isArray(row.values) ? row.values.find((item) => record(item) && item.symbol === symbol) : null).filter(record); }
function sameHistorical(value: unknown, expected: AnnualPortfolioHistoricalMetrics): boolean { const expectedRecord = expected as unknown as Record<string, unknown>; return record(value) && ["status", "annualizedVolatility", "historicalStressLossMagnitude", "historicalStressDate", "historicalTailLossMagnitude", "candidateRiskContribution", "limitation"].every((field) => value[field] === expectedRecord[field]); }
function difference(left: unknown, right: unknown): number | null { return finite(left) && finite(right) ? round(left - right, 10) : null; }
function tailLoss(values: number[], confidence: number): number { const count = Math.max(1, Math.ceil(values.length * (1 - confidence))); return Math.max(0, -mean([...values].sort((left, right) => left - right).slice(0, count))); }
function cov(left: number[], right: number[]): number { const lm = mean(left); const rm = mean(right); return left.reduce((sum, value, index) => sum + (value - lm) * (right[index] - rm), 0) / (left.length - 1); }
function std(values: number[]): number { return Math.sqrt(cov(values, values)); }
function mean(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function median(values: number[]): number { const sorted = [...values].sort((left, right) => left - right); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function unique(values: string[]): string[] { return [...new Set(values)]; }
function round(value: number, digits: number): number { const factor = 10 ** digits; return Math.round((value + Number.EPSILON) * factor) / factor; }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function positive(value: unknown): value is number { return finite(value) && value > 0; }
function nonNegative(value: unknown): value is number { return finite(value) && value >= 0; }
function positiveInteger(value: unknown): boolean { return Number.isSafeInteger(value) && Number(value) > 0; }
function requiredString(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function hash(value: unknown): boolean { return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value); }
function record(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function required(value: unknown, label: string, errors: string[]): void { if (!requiredString(value)) errors.push(`${label} is required`); }
function instant(value: unknown, label: string, errors: string[]): void { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || new Date(value).toISOString() !== value) errors.push(`${label} must be an ISO UTC instant`); }
function date(value: unknown, label: string, errors: string[]): void { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) errors.push(`${label} must be a calendar date`); }
function strings(value: unknown, label: string, errors: string[], allowEmpty = false): void { if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > 100 || value.some((item) => !requiredString(item))) errors.push(`${label} must contain bounded non-empty strings`); }
function same(left: unknown, right: unknown): boolean { return canonicalJson(left) === canonicalJson(right); }
function exact(value: Record<string, unknown>, keys: string[], label: string, errors: string[]): void { const set = new Set(keys); Object.keys(value).forEach((key) => { if (!set.has(key)) errors.push(`${label} contains unsupported field ${key}`); }); keys.forEach((key) => { if (!(key in value)) errors.push(`${label} is missing field ${key}`); }); }
async function sha(value: string): Promise<string> { if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is unavailable"); const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""); }
