import { makeFactMetadata } from "../../../../packages/contracts/src/factMetadata.js";
import { areInstantsChronologicallyOrdered } from "../../../../packages/contracts/src/chronology.js";
import type { CandidateDecisionIntakeEnvelope } from "../../../../packages/contracts/src/candidateDecisionIntake.js";
import type { DecisionQuantEvidence } from "../../../../packages/contracts/src/decisionQuantEvidenceContract.js";
import {
  ANNUAL_ADJUSTED_NET_ASSET_CALCULATION_VERSION,
  ANNUAL_ADJUSTED_NET_ASSET_VALUE_FORMULA,
  ANNUAL_VALUATION_CALCULATION_VERSION,
  ANNUAL_VALUATION_IMPLIED_EXPECTATION_FORMULA,
  ANNUAL_VALUATION_PRESENT_VALUE_FORMULA,
  ANNUAL_VALUATION_QUANT_WORKBENCH_SCHEMA_VERSION,
  calculateAnnualValuationScenarioGrid,
  annualValuationMethodId,
  validateAnnualQuantFilterInput,
  validateAnnualValuationQuantWorkbenchEnvelope,
  validateNewAnnualValuationScenarioInput,
  type AnnualQuantFilterInput,
  type AnnualQuantProductView,
  type AnnualValuationQuantWorkbenchEnvelope,
  type AnnualValuationResult,
  type AnnualValuationScenarioInput
} from "../../../../packages/contracts/src/annualValuationQuantWorkbench.js";
import { calculateAnnualValuationScenarioMargin } from "../../../../packages/contracts/src/annualValuationScenarioMargin.js";

export interface AnnualValuationQuantWorkbenchInput {
  valuation: AnnualValuationScenarioInput;
  quantFilter: AnnualQuantFilterInput;
}

export function parseAnnualValuationQuantWorkbenchQuery(query: Record<string, unknown>): {
  ok: true;
  value: AnnualValuationQuantWorkbenchInput;
} | {
  ok: false;
  errors: string[];
} {
  const allowedQueryKeys = new Set([
    "methodId", "metricCurrency", "baseMetricPerShare", "annualGrowthRate", "horizonYears", "terminalMultiple",
    "annualDiscountRate", "netCashPerShare", "growthRateStep", "multipleStep",
    "maxDrawdownMagnitude", "maxTurnoverOneWay", "minTradeCount"
  ]);
  const queryErrors = Object.keys(query)
    .filter((key) => !allowedQueryKeys.has(key))
    .map((key) => `unsupported valuation quant query field ${key}`);
  const valuation = {
    methodId: queryMethodId(query.methodId),
    metricCurrency: queryCurrency(query.metricCurrency),
    baseMetricPerShare: queryNumber(query.baseMetricPerShare),
    annualGrowthRate: queryNumber(query.annualGrowthRate),
    horizonYears: queryNumber(query.horizonYears),
    terminalMultiple: queryNumber(query.terminalMultiple),
    annualDiscountRate: queryNumber(query.annualDiscountRate),
    netCashPerShare: queryNumber(query.netCashPerShare),
    growthRateStep: queryNumber(query.growthRateStep),
    multipleStep: queryNumber(query.multipleStep)
  };
  const quantFilter = {
    maxDrawdownMagnitude: queryNumber(query.maxDrawdownMagnitude),
    maxTurnoverOneWay: queryNumber(query.maxTurnoverOneWay),
    minTradeCount: queryNumber(query.minTradeCount)
  };
  const valuationValidation = validateNewAnnualValuationScenarioInput(valuation);
  const filterValidation = validateAnnualQuantFilterInput(quantFilter);
  if (valuation.metricCurrency === undefined) {
    queryErrors.push("metricCurrency must be a three-letter uppercase currency code");
  }
  if (queryErrors.length > 0 || !valuationValidation.ok || !filterValidation.ok) {
    return {
      ok: false,
      errors: [
        ...queryErrors,
        ...(valuationValidation.ok ? [] : valuationValidation.errors),
        ...(filterValidation.ok ? [] : filterValidation.errors)
      ]
    };
  }
  return { ok: true, value: { valuation: valuationValidation.value, quantFilter: filterValidation.value } };
}

export function annualValuationQuantWorkbenchFromIntake(
  intake: CandidateDecisionIntakeEnvelope,
  input: AnnualValuationQuantWorkbenchInput,
  now = new Date()
): AnnualValuationQuantWorkbenchEnvelope {
  const generatedAt = now.toISOString();
  if (intake.status !== "available" || !intake.membership || !intake.decisionContext || !intake.requestedSymbol) {
    return annualValuationQuantWorkbenchFailClosedEnvelope(
      generatedAt,
      intake.membershipId,
      intake.requestedActorId,
      intake.status === "not_found" ? "not_found" : "unavailable",
      intake.message
    );
  }
  const membership = intake.membership;
  const context = intake.decisionContext;
  const valuation = buildValuation(context.quote, membership.state, input.valuation, now);
  const quant = buildQuantProductView(context.quantEvidence, input.quantFilter);
  const freshness = combinedFreshness(valuation.status, context.quantEvidence.metadata.freshness);
  const fixture = context.quote.metadata.fixture || context.quantEvidence.metadata.fixture;
  const envelope: AnnualValuationQuantWorkbenchEnvelope = {
    schemaVersion: ANNUAL_VALUATION_QUANT_WORKBENCH_SCHEMA_VERSION,
    generatedAt,
    status: "available",
    membershipId: membership.id,
    requestedActorId: intake.requestedActorId,
    requestedSymbol: membership.symbol,
    metadata: makeFactMetadata({
      source: "annual_valuation_quant_workbench:candidate_intake_quote_quant",
      asOf: latestIso(context.quote.metadata.asOf, context.quantEvidence.metadata.asOf),
      fetchedAt: generatedAt,
      freshness,
      provenance: fixture ? "fixture" : "research_only",
      authority: "research_evidence",
      stale: freshness === "stale",
      missing: freshness === "missing",
      conflict: freshness === "conflict",
      fixture,
      correctionOf: null,
      replaces: null,
      message: "User-defined valuation calculations and canonical quant evidence are composed for manual research only."
    }),
    data: {
      target: {
        membershipId: membership.id,
        membershipVersion: membership.version,
        membershipState: membership.state,
        market: "HK",
        code: membership.code,
        symbol: membership.symbol
      },
      sourceIdentity: {
        decisionContextId: context.contextId,
        decisionContextHash: context.contextHash,
        generatedAt
      },
      valuation,
      quant
    },
    safety: safetyBoundary(),
    message: `User-defined valuation and bounded quant evidence for ${membership.symbol}.`
  };
  return validateAnnualValuationQuantWorkbenchEnvelope(envelope).ok
    ? envelope
    : annualValuationQuantWorkbenchFailClosedEnvelope(
        generatedAt,
        membership.id,
        intake.requestedActorId,
        "unavailable",
        "Assembled valuation and quant workbench failed contract validation before response."
      );
}

export function annualValuationQuantWorkbenchFailClosedEnvelope(
  generatedAt: string,
  membershipId: string,
  actorId: string,
  status: "not_found" | "malformed" | "unavailable",
  message: string
): AnnualValuationQuantWorkbenchEnvelope {
  return {
    schemaVersion: ANNUAL_VALUATION_QUANT_WORKBENCH_SCHEMA_VERSION,
    generatedAt,
    status,
    membershipId,
    requestedActorId: actorId,
    requestedSymbol: null,
    metadata: makeFactMetadata({
      source: "annual_valuation_quant_workbench",
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
    safety: safetyBoundary(),
    message
  };
}

function buildValuation(
  quote: CandidateDecisionIntakeEnvelope["decisionContext"] extends infer _T ? NonNullable<CandidateDecisionIntakeEnvelope["decisionContext"]>["quote"] : never,
  membershipState: "tracked" | "paused" | "archived",
  inputs: AnnualValuationScenarioInput,
  evaluatedAt: Date
): AnnualValuationResult {
  const methodId = annualValuationMethodId(inputs);
  const adjusted = methodId === "adjusted_net_asset_value_user_scenario";
  const method: AnnualValuationResult["method"] = {
    id: methodId,
    calculationVersion: adjusted ? ANNUAL_ADJUSTED_NET_ASSET_CALCULATION_VERSION : ANNUAL_VALUATION_CALCULATION_VERSION,
    presentValueFormula: adjusted ? ANNUAL_ADJUSTED_NET_ASSET_VALUE_FORMULA : ANNUAL_VALUATION_PRESENT_VALUE_FORMULA,
    impliedExpectationFormula: ANNUAL_VALUATION_IMPLIED_EXPECTATION_FORMULA,
    rounding: "decimal_places_6",
    applicability: adjusted ? {
      ownerConfirmed: true,
      companyDataBasis: "reported_balance_sheet_net_assets_per_share",
      requiredAnchorMetrics: ["total_assets", "total_liabilities"],
      limitation: "Use only when Owner-confirmed reported balance-sheet facts support a net-asset-per-share basis; the workbench does not infer that basis."
    } : {
      ownerConfirmed: true,
      companyDataBasis: "forward_operating_metric_per_share",
      requiredAnchorMetrics: ["revenue", "profit_attributable_to_owners"],
      limitation: "Use only when Owner-confirmed operating-metric facts support the selected per-share basis; the workbench does not infer forecasts."
    }
  };
  if (membershipState === "archived") {
    return unavailableValuation("unavailable", inputs, method, "Archived candidates do not expose current valuation calculations.");
  }
  if (quote.status !== "fresh" || !quote.data || !quote.snapshotId || !quote.fetchedAt || !quote.source) {
    const status = quote.status === "stale"
      ? "stale"
      : quote.status === "empty"
        ? "missing"
        : quote.metadata.conflict
          ? "conflict"
          : "unavailable";
    return unavailableValuation(status, inputs, method, `Futu quote is ${quote.status}; no valuation output is calculated.`);
  }
  if (!inputs.metricCurrency || inputs.metricCurrency !== quote.data.currency) {
    return unavailableValuation(
      "conflict",
      inputs,
      method,
      inputs.metricCurrency
        ? `User metric currency ${inputs.metricCurrency} does not match Futu quote currency ${quote.data.currency}; no valuation output is calculated.`
        : "User metric currency is missing; no valuation output is calculated."
    );
  }
  if (!areInstantsChronologicallyOrdered([quote.data.quoteTime, quote.fetchedAt, evaluatedAt])) return unavailableValuation("conflict", inputs, method, "Futu quote chronology is invalid; no valuation output is calculated.");
  const calculation = calculateAnnualValuationScenarioGrid(inputs);
  if (!calculation) {
    return unavailableValuation(
      "unavailable",
      inputs,
      method,
      "The user-defined assumptions do not produce a finite positive present value; no output is displayed."
    );
  }
  const impliedBase = (quote.data.price - inputs.netCashPerShare) * calculation.discountFactor
    / (inputs.baseMetricPerShare * inputs.terminalMultiple);
  const impliedGrowth = impliedBase > 0
    ? Math.pow(impliedBase, 1 / inputs.horizonYears) - 1
    : null;
  const scenarioValues = [calculation.cells[0], calculation.cells[4], calculation.cells[8]]
    .map((cell) => cell.presentValuePerShare);
  const rangeLow = Math.min(...scenarioValues);
  const rangeHigh = Math.max(...scenarioValues);
  return {
    status: "available",
    quote: {
      snapshotId: quote.snapshotId,
      symbol: quote.data.symbol,
      currency: quote.data.currency,
      price: quote.data.price,
      quoteTime: quote.data.quoteTime,
      fetchedAt: quote.fetchedAt,
      source: quote.source
    },
    inputs,
    method,
    outputs: {
      projectedMetricPerShare: calculation.projectedMetricPerShare,
      scenarioPresentValuePerShare: calculation.scenarioPresentValuePerShare,
      impliedAnnualGrowthRateAtCurrentPrice: impliedGrowth === null || !Number.isFinite(impliedGrowth)
        ? null
        : roundSix(impliedGrowth),
      impliedExpectationStatus: impliedGrowth === null || !Number.isFinite(impliedGrowth)
        ? "not_computable"
        : "available",
      valueRange: {
        low: rangeLow,
        high: rangeHigh,
        interpretation: "research_scenario_range_not_target_price"
      },
      scenarioMarginOfSafety: calculateAnnualValuationScenarioMargin(
        quote.data.price, rangeLow, calculation.scenarioPresentValuePerShare, rangeHigh
      )
    },
    sensitivity: {
      growthRates: calculation.growthRates,
      terminalMultiples: calculation.terminalMultiples,
      cells: calculation.cells
    },
    limitations: [
      "Every assumption is supplied by the user; the system provides no default fair value or target price.",
      adjusted
        ? "The adjusted net-asset method requires Owner-confirmed reported balance-sheet applicability; it is not forced onto operating businesses."
        : "The forward-metric method requires Owner-confirmed operating-metric applicability; it is not forced onto asset-backed businesses.",
      "The calculation is a transparent three-scenario research range, not a forecast, target price, recommendation, ranking, or trading instruction.",
      "The per-share basis and adjustments are user inputs and are not verified accounting facts."
    ]
  };
}

function unavailableValuation(
  status: Exclude<AnnualValuationResult["status"], "available">,
  inputs: AnnualValuationScenarioInput,
  method: AnnualValuationResult["method"],
  limitation: string
): AnnualValuationResult {
  return {
    status,
    quote: null,
    inputs,
    method,
    outputs: null,
    sensitivity: null,
    limitations: [limitation, "No stale or partial valuation result is reused."]
  };
}

function buildQuantProductView(
  evidence: DecisionQuantEvidence,
  criteria: AnnualQuantFilterInput
): AnnualQuantProductView {
  const identities = evidence.status === "available" ? evidence.identities : null;
  const refinement = evidence.decisionEvidence;
  const availableRefinement = refinement?.status === "available" ? refinement : null;
  const outerUnavailable = evidence.status !== "available", diagnosticStatus = outerUnavailable ? "unavailable" : "not_captured";
  const gap = (subject: string) => ({
    status: diagnosticStatus,
    limitation: outerUnavailable
      ? `${subject} is unavailable because canonical quant evidence is ${evidence.status}.`
      : `${subject} is not captured by the accepted quant evidence manifest; it is not inferred from adjacent artifacts.`
  } as const);
  const formalDiagnostic = (id: string, subject: string) => {
    const check = availableRefinement?.formalEvidence?.checks.find((item) => item.id === id);
    return check?.status === "available"
      ? { status: "available" as const, limitation: check.limitation }
      : gap(subject);
  };
  const sourceFailed = availableRefinement?.robustness?.failedExperiments;
  const availableSamples = availableRefinement?.samples.length && availableRefinement.samples.every((sample) => sample.metrics.simulatedClosedRoundTripCount !== undefined) ? availableRefinement.samples : null;
  const filterSamples = availableRefinement?.samples.map((sample, sourceIndex) => {
    const maxDrawdownMagnitude = roundSix(Math.abs(sample.metrics.simulatedMaxDrawdown));
    const turnoverOneWay = roundSix(sample.metrics.simulatedTurnoverOneWay);
    const tradeCount = sample.metrics.simulatedTradeCount;
    const matchesMaxDrawdown = maxDrawdownMagnitude <= criteria.maxDrawdownMagnitude;
    const matchesMaxTurnover = turnoverOneWay <= criteria.maxTurnoverOneWay;
    const matchesMinTradeCount = tradeCount >= criteria.minTradeCount;
    return {
      sampleId: sample.id,
      sourceIndex,
      maxDrawdownMagnitude,
      turnoverOneWay,
      tradeCount,
      matchesMaxDrawdown,
      matchesMaxTurnover,
      matchesMinTradeCount,
      allCriteriaMatched: matchesMaxDrawdown && matchesMaxTurnover && matchesMinTradeCount
    };
  }) ?? [];
  const product: AnnualQuantProductView = {
    status: evidence.status,
    evidence,
    model: {
      modelVersion: identities?.baselineExperimentIdentity ?? null,
      universe: [...evidence.sampleBoundary.universe],
      sourceClassification: evidence.sampleBoundary.sourceClassification,
      adjustment: availableRefinement?.source?.adjustment ?? null,
      dataCutoff: availableRefinement?.source?.dataCutoff ?? null,
      snapshotId: identities?.frozenSnapshot.snapshotId ?? null,
      snapshotHash: identities?.frozenSnapshot.snapshotHash ?? null,
      codeIdentity: identities?.baselineExperimentIdentity ?? null
    },
    diagnostics: {
      benchmark: formalDiagnostic("benchmark", "Benchmark comparison"),
      sampleSize: availableSamples ? { status: "available", limitation: `${availableSamples.length} fixed windows · ${availableSamples.reduce((sum, sample) => sum + sample.metrics.simulatedTradeCount, 0)} simulated executions · ${availableSamples.reduce((sum, sample) => sum + (sample.metrics.simulatedClosedRoundTripCount ?? 0), 0)} closed round trips; no sample-size threshold is treated as recommendation authority.` } : gap("Observation sample size"),
      concentration: formalDiagnostic("trade_stock_month_concentration", "Trade, stock, and month concentration"),
      parameterNeighborhood: formalDiagnostic("parameter_search", "Parameter-neighborhood robustness"),
      marketEnvironment: gap("Market-environment or regime classification"),
      failedExperiments: sourceFailed
        ? {
            status: sourceFailed.status === "registered" ? "available" : "not_captured",
            experimentIds: [...sourceFailed.experimentIds],
            limitation: sourceFailed.limitation
          }
        : {
            status: outerUnavailable ? "unavailable" : "not_captured",
            experimentIds: [],
            limitation: outerUnavailable
              ? "Failed experiments are unavailable with the canonical quant evidence."
              : "Failed experiments were not captured; no successful-only inference is made."
          }
    },
    filter: {
      status: availableRefinement ? "available" : outerUnavailable ? "unavailable" : "not_captured",
      criteria,
      samples: filterSamples,
      preservesSourceOrder: true,
      ranking: false,
      score: false,
      recommendation: false
    },
    limitations: uniqueStrings([
      ...evidence.limitations,
      ...(refinement?.limitations ?? []),
      "User-defined filters annotate canonical sample order only; they never rank candidates, score strategies, or select a strategy."
    ])
  };
  return product;
}

function combinedFreshness(...values: string[]): "fresh" | "historical" | "stale" | "missing" | "unavailable" | "conflict" {
  if (values.includes("conflict")) return "conflict";
  if (values.some((value) => value === "unavailable" || value === "unknown")) return "unavailable";
  if (values.includes("missing")) return "missing";
  if (values.includes("stale")) return "stale";
  if (values.includes("historical")) return "historical";
  return "fresh";
}

function latestIso(...values: Array<string | null>): string | null {
  return values.filter((value): value is string => typeof value === "string")
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
}

function queryNumber(value: unknown): number {
  if (typeof value !== "string" || value.trim() === "" || value.trim() !== value) return Number.NaN;
  return Number(value);
}

function queryCurrency(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value) ? value : undefined;
}

function queryMethodId(value: unknown): AnnualValuationScenarioInput["methodId"] {
  if (value === undefined) return undefined;
  return value === "discounted_forward_metric_multiple_user_scenario"
    || value === "adjusted_net_asset_value_user_scenario"
    ? value
    : "invalid" as AnnualValuationScenarioInput["methodId"];
}

function roundSix(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function safetyBoundary(): AnnualValuationQuantWorkbenchEnvelope["safety"] {
  return {
    advisoryOnly: true,
    userInputsRequired: true,
    changesCandidateOrdering: false,
    recommendation: false,
    ranking: false,
    score: false,
    targetPrice: false,
    targetPosition: false,
    tradeDirection: false,
    createsOrder: false,
    createsTrade: false,
    callsBroker: false,
    mutatesOfficialPortfolio: false
  };
}
