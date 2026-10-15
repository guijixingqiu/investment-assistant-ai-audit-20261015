import { canonicalJson } from "./decisionContextBrowser.js";
import { isRfc3339DateTime } from "./factMetadata.js";
import { RESEARCH_EVENT_KINDS, type ResearchEventKind } from "./researchEvent.js";

export const GCL_PV_PRICE_MONITOR_SCHEMA_VERSION = "2026-07-25.gcl-pv-price-monitor.v1";
export const GCL_PV_STAGES = ["polysilicon", "wafer", "cell", "module"] as const;
export const GCL_PV_PRICE_UNITS = ["CNY_per_kg", "CNY_per_piece", "CNY_per_watt"] as const;
export const GCL_PV_CONTEXT_METRICS = ["inventory", "utilization", "capacity", "company_cost", "impairment"] as const;
export const GCL_PV_CONTEXT_UNITS = ["metric_tonnes", "percent", "metric_tonnes_per_year", "CNY_per_kg", "CNY"] as const;

export interface GclPvPriceInputObservation {
  eventId: string;
  stage: (typeof GCL_PV_STAGES)[number];
  period: string;
  productSpecification: string;
  unit: (typeof GCL_PV_PRICE_UNITS)[number];
  currency: "CNY";
  value: number;
  conversionFactorToCnyPerWatt: number;
  normalizationBasisKey: string;
  normalizationRule: string;
  definitionKey: string;
}

export interface GclPvContextInputObservation {
  eventId: string;
  metric: (typeof GCL_PV_CONTEXT_METRICS)[number];
  period: string;
  productSpecification: string;
  unit: (typeof GCL_PV_CONTEXT_UNITS)[number];
  currency: "CNY" | null;
  value: number;
  definitionKey: string;
}

export interface CreateGclPvPriceMonitorRequest {
  membershipVersion: number;
  period: string;
  referencePeriod: string;
  priceObservations: GclPvPriceInputObservation[];
  contextObservations: GclPvContextInputObservation[];
  idempotencyKey: string;
}

export interface GclPvSourceEvent {
  eventId: string;
  eventVersion: number;
  eventFingerprint: string;
  symbol: string;
  eventKind: ResearchEventKind;
  coverageScope: "current_holding";
  holdingBinding: {
    accountScopeId: string;
    snapshotId: string;
    sourceBatchId: string;
    sourceAsOf: string;
    positionSourceRowId: string;
  };
  materialId: string;
  materialFingerprint: string;
  sourceType: string;
  sourceUrl: string | null;
  publishedAt: string;
  capturedAt: string;
  validUntil: string;
  rightsStatus: "user_provided" | "authorized_public";
  verificationStatus: "verified";
  sourceVersion: string;
  revision: number;
  keyVariable: string;
  hypothesisImpact: "supports" | "weakens" | "unknown";
}

export interface GclPvPriceObservation extends GclPvPriceInputObservation {
  normalizedCnyPerWatt: number;
  sourceEvent: GclPvSourceEvent;
}

export interface GclPvContextObservation extends GclPvContextInputObservation {
  sourceEvent: GclPvSourceEvent;
}

export interface GclPvComparison {
  id: string;
  status: "comparable" | "missing" | "incomparable" | "zero_baseline";
  currentPeriod: string;
  referencePeriod: string;
  currentValue: number | null;
  referenceValue: number | null;
  percentChange: number | null;
  changePercentagePoints: number | null;
  unit: string | null;
  reason: string;
}

export interface GclPvSpread {
  id: string;
  upstreamStage: GclPvPriceInputObservation["stage"];
  downstreamStage: GclPvPriceInputObservation["stage"];
  status: "comparable" | "missing" | "incomparable";
  currentCnyPerWatt: number | null;
  referenceCnyPerWatt: number | null;
  changeCnyPerWatt: number | null;
  reason: string;
}

export interface GclPvImpact {
  signal: "supports" | "weakens" | "mixed" | "unknown";
  basis: string[];
  unknowns: string[];
}

export interface GclPvPriceAssessment {
  status: "comparable" | "incomparable" | "insufficient";
  trendConclusionAllowed: boolean;
  spreadConclusionAllowed: boolean;
  blockers: string[];
  priceTrends: GclPvComparison[];
  spreads: GclPvSpread[];
  context: GclPvComparison[];
  impacts: {
    cost: GclPvImpact;
    profit: GclPvImpact;
    impairment: GclPvImpact;
    industryClearing: GclPvImpact;
    thesis: GclPvImpact;
  };
}

export interface GclPvPriceMonitorData {
  id: string;
  runVersion: number;
  runFingerprint: string;
  membershipId: string;
  membershipVersion: number;
  market: "HK";
  code: "03800";
  symbol: "HK.03800";
  period: string;
  referencePeriod: string;
  priceObservations: GclPvPriceObservation[];
  contextObservations: GclPvContextObservation[];
  assessment: GclPvPriceAssessment;
  createdAt: string;
  safety: {
    advisoryOnly: true;
    createsOrder: false;
    createsTrade: false;
    mutatesCash: false;
    writesFee: false;
    mutatesPosition: false;
    callsBroker: false;
    productionWrite: false;
  };
}

export function validateCreateGclPvPriceMonitorRequest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return invalid(["request must be an object"]);
  exact(value, ["membershipVersion", "period", "referencePeriod", "priceObservations", "contextObservations", "idempotencyKey"], "request", errors);
  if (!positiveInteger(value.membershipVersion)) errors.push("membershipVersion must be a positive integer");
  if (!day(value.period) || !day(value.referencePeriod) || String(value.referencePeriod) >= String(value.period)) errors.push("periods must be ordered YYYY-MM-DD dates");
  if (!bounded(value.idempotencyKey, 200)) errors.push("idempotencyKey must be a non-empty string of at most 200 characters");
  if (!Array.isArray(value.priceObservations) || value.priceObservations.length < 1 || value.priceObservations.length > 100) {
    errors.push("priceObservations must contain 1-100 rows");
  } else {
    value.priceObservations.forEach((item, index) => validatePriceInput(item, value.period, value.referencePeriod, `priceObservations[${index}]`, errors));
    unique(value.priceObservations, (item) => record(item) ? `${item.stage}|${item.period}` : "", "priceObservations contain duplicate stage-period rows", errors);
  }
  if (!Array.isArray(value.contextObservations) || value.contextObservations.length > 50) {
    errors.push("contextObservations must contain 0-50 rows");
  } else {
    value.contextObservations.forEach((item, index) => validateContextInput(item, value.period, value.referencePeriod, `contextObservations[${index}]`, errors));
    unique(value.contextObservations, (item) => record(item) ? `${item.metric}|${item.period}` : "", "contextObservations contain duplicate metric-period rows", errors);
  }
  return errors.length ? invalid(errors) : { ok: true };
}

export function buildGclPvPriceAssessment(
  prices: GclPvPriceObservation[],
  contexts: GclPvContextObservation[],
  period: string,
  referencePeriod: string
): GclPvPriceAssessment {
  const current = new Map(GCL_PV_STAGES.map((stage) => [stage, one(prices.filter((item) => item.stage === stage && item.period === period))]));
  const priceTrends = GCL_PV_STAGES.map((stage) => comparePrice(stage, current.get(stage) ?? null, prices, referencePeriod));
  const spreads = [
    spread("wafer_minus_polysilicon", "polysilicon", "wafer", current, prices, referencePeriod),
    spread("cell_minus_wafer", "wafer", "cell", current, prices, referencePeriod),
    spread("module_minus_cell", "cell", "module", current, prices, referencePeriod)
  ];
  const context = GCL_PV_CONTEXT_METRICS.map((metric) => compareContext(
    metric,
    one(contexts.filter((item) => item.metric === metric && item.period === period)),
    contexts,
    referencePeriod
  ));
  const blockers = [
    ...priceTrends.filter((item) => item.status !== "comparable").map((item) => `${item.id}: ${item.reason}`),
    ...spreads.filter((item) => item.status !== "comparable").map((item) => `${item.id}: ${item.reason}`)
  ];
  const incomparable = [...priceTrends, ...spreads].some((item) => item.status === "incomparable");
  const priceDirection = direction(priceTrends.find((item) => item.id === "polysilicon_price_trend")?.percentChange, true, "polysilicon price");
  const costComparison = context.find((item) => item.id === "company_cost");
  const costDirection = direction(costComparison?.percentChange, false, "company cost");
  const impairment = one(contexts.filter((item) => item.metric === "impairment" && item.period === period));
  const contextUnknowns = GCL_PV_CONTEXT_METRICS.filter((metric) => !contexts.some((item) => item.metric === metric && item.period === period));
  return {
    status: incomparable ? "incomparable" : blockers.length ? "insufficient" : "comparable",
    trendConclusionAllowed: priceTrends.every((item) => item.status === "comparable"),
    spreadConclusionAllowed: spreads.every((item) => item.status === "comparable"),
    blockers: [...new Set(blockers)].sort(),
    priceTrends,
    spreads,
    context,
    impacts: {
      cost: impact([costDirection], costDirection ? [] : ["comparable company cost disclosure is missing"]),
      profit: impact([priceDirection, costDirection], ["volume, mix, yield, inventory accounting and realized sales are not price-series facts"]),
      impairment: impairment && impairment.value > 0
        ? { signal: "weakens", basis: [`reported impairment input ${impairment.value} ${impairment.unit}`], unknowns: ["recoverability and accounting judgment require reviewed issuer evidence"] }
        : { signal: "unknown", basis: [], unknowns: ["current impairment disclosure is absent or does not state a positive charge"] },
      industryClearing: sourceImpact(contexts.filter((item) => ["inventory", "utilization", "capacity"].includes(item.metric)), ["numeric operating context alone does not prove industry clearing"]),
      thesis: sourceImpact([...prices, ...contexts], contextUnknowns.map((item) => `${item} input is unknown`))
    }
  };
}

export function validateGclPvPriceMonitorData(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return invalid(["monitor data must be an object"]);
  exact(value, ["id", "runVersion", "runFingerprint", "membershipId", "membershipVersion", "market", "code", "symbol", "period", "referencePeriod", "priceObservations", "contextObservations", "assessment", "createdAt", "safety"], "monitor", errors);
  if (!positiveId(value.id) || !positiveInteger(value.runVersion) || !positiveId(value.membershipId) || !positiveInteger(value.membershipVersion)) errors.push("monitor identity is invalid");
  if (!hash(value.runFingerprint)) errors.push("runFingerprint is invalid");
  if (value.market !== "HK" || value.code !== "03800" || value.symbol !== "HK.03800" || !day(value.period) || !day(value.referencePeriod) || String(value.referencePeriod) >= String(value.period)) errors.push("monitor target or periods are invalid");
  const prices = Array.isArray(value.priceObservations) ? value.priceObservations : [];
  const contexts = Array.isArray(value.contextObservations) ? value.contextObservations : [];
  if (prices.length < 1 || prices.length > 100) errors.push("priceObservations must contain 1-100 rows");
  if (contexts.length > 50) errors.push("contextObservations must contain 0-50 rows");
  unique(prices, (item) => record(item) ? `${item.stage}|${item.period}` : "", "priceObservations contain duplicate stage-period rows", errors);
  unique(contexts, (item) => record(item) ? `${item.metric}|${item.period}` : "", "contextObservations contain duplicate metric-period rows", errors);
  prices.forEach((item, index) => validatePriceOutput(item, value.period, value.referencePeriod, `priceObservations[${index}]`, errors));
  contexts.forEach((item, index) => validateContextOutput(item, value.period, value.referencePeriod, `contextObservations[${index}]`, errors));
  if (!prices.length || canonicalJson(value.assessment) !== canonicalJson(buildGclPvPriceAssessment(prices as GclPvPriceObservation[], contexts as GclPvContextObservation[], String(value.period), String(value.referencePeriod)))) errors.push("assessment does not deterministically recompute");
  if (!instant(value.createdAt)) errors.push("createdAt is invalid");
  else if (String(value.period) > String(value.createdAt).slice(0, 10)
    || [...prices, ...contexts].some((item) => record(item) && record(item.sourceEvent) && Date.parse(String(item.sourceEvent.capturedAt)) > Date.parse(String(value.createdAt)))) errors.push("monitor period or source capture time is in the future");
  if (!record(value.safety) || canonicalJson(value.safety) !== canonicalJson(safety())) errors.push("monitor safety boundary is invalid");
  return errors.length ? invalid(errors) : { ok: true };
}

export function gclPvPriceSafety(): GclPvPriceMonitorData["safety"] { return safety(); }

function comparePrice(stage: GclPvPriceInputObservation["stage"], current: GclPvPriceObservation | null, rows: GclPvPriceObservation[], referencePeriod: string): GclPvComparison {
  const id = `${stage}_price_trend`;
  if (!current) return comparison(id, "missing", "", referencePeriod, null, null, null, null, "CNY_per_watt", "current price is missing");
  const exactRows = rows.filter((item) => item.period === referencePeriod && samePriceSeries(item, current));
  if (exactRows.length === 1) {
    const reference = exactRows[0].normalizedCnyPerWatt;
    if (reference === 0) return comparison(id, "zero_baseline", current.period, referencePeriod, current.normalizedCnyPerWatt, 0, null, null, "CNY_per_watt", "reference normalized price is zero");
    return comparison(id, "comparable", current.period, referencePeriod, current.normalizedCnyPerWatt, reference, round((current.normalizedCnyPerWatt / reference - 1) * 100), null, "CNY_per_watt", "exact specification, unit, currency, normalization and definition match");
  }
  const near = rows.some((item) => item.stage === stage && item.period === referencePeriod);
  return comparison(id, near ? "incomparable" : "missing", current.period, referencePeriod, current.normalizedCnyPerWatt, null, null, null, "CNY_per_watt", near ? "reference exists with a different specification, unit, currency, normalization or definition" : "reference price is missing");
}

function spread(id: string, upstreamStage: GclPvPriceInputObservation["stage"], downstreamStage: GclPvPriceInputObservation["stage"], current: Map<string, GclPvPriceObservation | null>, rows: GclPvPriceObservation[], referencePeriod: string): GclPvSpread {
  const upstream = current.get(upstreamStage) ?? null; const downstream = current.get(downstreamStage) ?? null;
  if (!upstream || !downstream) return spreadResult(id, upstreamStage, downstreamStage, "missing", null, null, null, "one or both current stage prices are missing");
  if (upstream.normalizationBasisKey !== downstream.normalizationBasisKey) return spreadResult(id, upstreamStage, downstreamStage, "incomparable", null, null, null, "current prices use different normalized chain bases");
  const upstreamReference = one(rows.filter((item) => item.period === referencePeriod && samePriceSeries(item, upstream)));
  const downstreamReference = one(rows.filter((item) => item.period === referencePeriod && samePriceSeries(item, downstream)));
  if (!upstreamReference || !downstreamReference) {
    const near = rows.some((item) => item.period === referencePeriod && item.stage === upstreamStage) && rows.some((item) => item.period === referencePeriod && item.stage === downstreamStage);
    return spreadResult(id, upstreamStage, downstreamStage, near ? "incomparable" : "missing", null, null, null, near ? "reference prices use incompatible definitions" : "one or both reference stage prices are missing");
  }
  if (upstreamReference.normalizationBasisKey !== downstreamReference.normalizationBasisKey
    || upstream.normalizationBasisKey !== upstreamReference.normalizationBasisKey) return spreadResult(id, upstreamStage, downstreamStage, "incomparable", null, null, null, "current and reference prices do not share one normalized chain basis");
  const currentSpread = round(downstream.normalizedCnyPerWatt - upstream.normalizedCnyPerWatt);
  const referenceSpread = round(downstreamReference.normalizedCnyPerWatt - upstreamReference.normalizedCnyPerWatt);
  return spreadResult(id, upstreamStage, downstreamStage, "comparable", currentSpread, referenceSpread, round(currentSpread - referenceSpread), "normalized supplied proxy; not accounting gross margin");
}

function compareContext(metric: GclPvContextInputObservation["metric"], current: GclPvContextObservation | null, rows: GclPvContextObservation[], referencePeriod: string): GclPvComparison {
  if (!current) return comparison(metric, "missing", "", referencePeriod, null, null, null, null, null, "current context is unknown");
  const matches = rows.filter((item) => item.period === referencePeriod && sameContextSeries(item, current));
  if (matches.length !== 1) {
    const near = rows.some((item) => item.metric === metric && item.period === referencePeriod);
    return comparison(metric, near ? "incomparable" : "missing", current.period, referencePeriod, current.value, null, null, null, current.unit, near ? "reference context uses a different specification, unit, currency or definition" : "reference context is unknown");
  }
  const reference = matches[0].value;
  if (metric === "utilization") return comparison(metric, "comparable", current.period, referencePeriod, current.value, reference, null, round(current.value - reference), current.unit, "percentage-point comparison");
  if (reference === 0) return comparison(metric, "zero_baseline", current.period, referencePeriod, current.value, 0, null, null, current.unit, "reference value is zero");
  return comparison(metric, "comparable", current.period, referencePeriod, current.value, reference, round((current.value / reference - 1) * 100), null, current.unit, "exact context definition match");
}

function validatePriceInput(value: unknown, period: unknown, referencePeriod: unknown, label: string, errors: string[]): void {
  if (!record(value)) { errors.push(`${label} must be an object`); return; }
  exact(value, ["eventId", "stage", "period", "productSpecification", "unit", "currency", "value", "conversionFactorToCnyPerWatt", "normalizationBasisKey", "normalizationRule", "definitionKey"], label, errors);
  if (!positiveId(value.eventId) || !GCL_PV_STAGES.includes(value.stage as never) || ![period, referencePeriod].includes(value.period) || !day(value.period)) errors.push(`${label} identity or period is invalid`);
  if (!bounded(value.productSpecification, 300) || !GCL_PV_PRICE_UNITS.includes(value.unit as never) || value.currency !== "CNY" || !finitePositive(value.value) || !finitePositive(value.conversionFactorToCnyPerWatt)) errors.push(`${label} price specification, unit, currency or value is invalid`);
  if (value.unit === "CNY_per_watt" && value.conversionFactorToCnyPerWatt !== 1) errors.push(`${label} CNY_per_watt conversion factor must equal 1`);
  if (!identifier(value.normalizationBasisKey) || !bounded(value.normalizationRule, 500) || !bounded(value.definitionKey, 200)) errors.push(`${label} normalization or definition is invalid`);
}

function validateContextInput(value: unknown, period: unknown, referencePeriod: unknown, label: string, errors: string[]): void {
  if (!record(value)) { errors.push(`${label} must be an object`); return; }
  exact(value, ["eventId", "metric", "period", "productSpecification", "unit", "currency", "value", "definitionKey"], label, errors);
  if (!positiveId(value.eventId) || !GCL_PV_CONTEXT_METRICS.includes(value.metric as never) || ![period, referencePeriod].includes(value.period) || !day(value.period)) errors.push(`${label} identity or period is invalid`);
  if (!bounded(value.productSpecification, 300) || !GCL_PV_CONTEXT_UNITS.includes(value.unit as never) || !finiteNonnegative(value.value) || !bounded(value.definitionKey, 200)) errors.push(`${label} context definition or value is invalid`);
  const expected = contextDimension(String(value.metric));
  if (value.unit !== expected.unit || value.currency !== expected.currency || value.metric === "utilization" && Number(value.value) > 100) errors.push(`${label} metric unit, currency or range is invalid`);
}

function validatePriceOutput(value: unknown, period: unknown, referencePeriod: unknown, label: string, errors: string[]): void {
  if (!record(value)) { errors.push(`${label} must be an object`); return; }
  validatePriceInput(without(value, ["normalizedCnyPerWatt", "sourceEvent"]), period, referencePeriod, label, errors);
  if (!finitePositive(value.normalizedCnyPerWatt) || value.normalizedCnyPerWatt !== round(Number(value.value) * Number(value.conversionFactorToCnyPerWatt))) errors.push(`${label} normalized price does not recompute`);
  validateSource(value.sourceEvent, value.eventId, priceVariable(String(value.stage)), `${label}.sourceEvent`, errors);
}

function validateContextOutput(value: unknown, period: unknown, referencePeriod: unknown, label: string, errors: string[]): void {
  if (!record(value)) { errors.push(`${label} must be an object`); return; }
  validateContextInput(without(value, ["sourceEvent"]), period, referencePeriod, label, errors);
  validateSource(value.sourceEvent, value.eventId, String(value.metric), `${label}.sourceEvent`, errors);
}

function validateSource(value: unknown, eventId: unknown, keyVariable: string, label: string, errors: string[]): void {
  if (!record(value)) { errors.push(`${label} is required`); return; }
  exact(value, ["eventId", "eventVersion", "eventFingerprint", "symbol", "eventKind", "coverageScope", "holdingBinding", "materialId", "materialFingerprint", "sourceType", "sourceUrl", "publishedAt", "capturedAt", "validUntil", "rightsStatus", "verificationStatus", "sourceVersion", "revision", "keyVariable", "hypothesisImpact"], label, errors);
  if (value.eventId !== eventId || !positiveInteger(value.eventVersion) || !hash(value.eventFingerprint) || value.symbol !== "HK.03800" || !RESEARCH_EVENT_KINDS.includes(value.eventKind as ResearchEventKind) || value.coverageScope !== "current_holding" || !positiveId(value.materialId) || !hash(value.materialFingerprint)) errors.push(`${label} identity is invalid`);
  validateHoldingBinding(value.holdingBinding, `${label}.holdingBinding`, errors);
  if (!bounded(value.sourceType, 200) || !optionalUrl(value.sourceUrl) || !instant(value.publishedAt) || !instant(value.capturedAt) || !instant(value.validUntil) || Date.parse(String(value.publishedAt)) > Date.parse(String(value.capturedAt)) || Date.parse(String(value.validUntil)) <= Date.parse(String(value.capturedAt))) errors.push(`${label} timeline is invalid`);
  if (!["user_provided", "authorized_public"].includes(String(value.rightsStatus)) || value.verificationStatus !== "verified" || !bounded(value.sourceVersion, 200) || !positiveInteger(value.revision) || value.keyVariable !== keyVariable || !["supports", "weakens", "unknown"].includes(String(value.hypothesisImpact))) errors.push(`${label} is not eligible`);
}

function comparison(id: string, status: GclPvComparison["status"], currentPeriod: string, referencePeriod: string, currentValue: number | null, referenceValue: number | null, percentChange: number | null, changePercentagePoints: number | null, unit: string | null, reason: string): GclPvComparison { return { id, status, currentPeriod, referencePeriod, currentValue, referenceValue, percentChange, changePercentagePoints, unit, reason }; }
function spreadResult(id: string, upstreamStage: GclPvSpread["upstreamStage"], downstreamStage: GclPvSpread["downstreamStage"], status: GclPvSpread["status"], currentCnyPerWatt: number | null, referenceCnyPerWatt: number | null, changeCnyPerWatt: number | null, reason: string): GclPvSpread { return { id, upstreamStage, downstreamStage, status, currentCnyPerWatt, referenceCnyPerWatt, changeCnyPerWatt, reason }; }
function direction(value: number | null | undefined, positiveSupports: boolean, label: string): { signal: "supports" | "weakens"; basis: string } | null { if (!value) return null; return { signal: value > 0 === positiveSupports ? "supports" : "weakens", basis: `${label} changed ${value}%` }; }
function impact(items: Array<{ signal: "supports" | "weakens"; basis: string } | null>, unknowns: string[]): GclPvImpact { const usable = items.filter((item): item is NonNullable<typeof item> => item !== null); const signals = new Set(usable.map((item) => item.signal)); return { signal: !signals.size ? "unknown" : signals.size > 1 ? "mixed" : [...signals][0], basis: usable.map((item) => item.basis), unknowns }; }
function sourceImpact(rows: Array<{ sourceEvent: GclPvSourceEvent }>, unknowns: string[]): GclPvImpact { const signals = [...new Set(rows.map((item) => item.sourceEvent.hypothesisImpact).filter((item) => item !== "unknown"))]; const basis = [...new Set(rows.filter((item) => item.sourceEvent.hypothesisImpact !== "unknown").map((item) => `source event ${item.sourceEvent.eventId}: ${item.sourceEvent.hypothesisImpact}`))]; return { signal: !signals.length ? "unknown" : signals.length > 1 ? "mixed" : signals[0], basis, unknowns }; }
function samePriceSeries(a: GclPvPriceInputObservation, b: GclPvPriceInputObservation): boolean { return a.stage === b.stage && a.productSpecification === b.productSpecification && a.unit === b.unit && a.currency === b.currency && a.conversionFactorToCnyPerWatt === b.conversionFactorToCnyPerWatt && a.normalizationBasisKey === b.normalizationBasisKey && a.normalizationRule === b.normalizationRule && a.definitionKey === b.definitionKey; }
function sameContextSeries(a: GclPvContextInputObservation, b: GclPvContextInputObservation): boolean { return a.metric === b.metric && a.productSpecification === b.productSpecification && a.unit === b.unit && a.currency === b.currency && a.definitionKey === b.definitionKey; }
function contextDimension(metric: string): { unit: string; currency: "CNY" | null } { if (metric === "inventory") return { unit: "metric_tonnes", currency: null }; if (metric === "utilization") return { unit: "percent", currency: null }; if (metric === "capacity") return { unit: "metric_tonnes_per_year", currency: null }; if (metric === "company_cost") return { unit: "CNY_per_kg", currency: "CNY" }; return { unit: "CNY", currency: "CNY" }; }
function validateHoldingBinding(value: unknown, label: string, errors: string[]): void { if (!record(value)) { errors.push(`${label} is required`); return; } exact(value, ["accountScopeId", "snapshotId", "sourceBatchId", "sourceAsOf", "positionSourceRowId"], label, errors); if (!bounded(value.accountScopeId, 500) || !bounded(value.snapshotId, 500) || !bounded(value.sourceBatchId, 500) || !instant(value.sourceAsOf) || !bounded(value.positionSourceRowId, 1000) || !String(value.positionSourceRowId).startsWith(`broker_import_batches:${value.sourceBatchId}/`)) errors.push(`${label} is invalid`); }
function priceVariable(stage: string): string { return `${stage}_price`; }
function one<T>(rows: T[]): T | null { return rows.length === 1 ? rows[0] : null; }
function unique<T>(rows: T[], key: (row: T) => string, message: string, errors: string[]): void { const keys = rows.map(key); if (new Set(keys).size !== keys.length) errors.push(message); }
function without(value: Record<string, unknown>, keys: string[]): Record<string, unknown> { const excluded = new Set(keys); return Object.fromEntries(Object.entries(value).filter(([key]) => !excluded.has(key))); }
function safety(): GclPvPriceMonitorData["safety"] { return { advisoryOnly: true, createsOrder: false, createsTrade: false, mutatesCash: false, writesFee: false, mutatesPosition: false, callsBroker: false, productionWrite: false }; }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000; }
function day(value: unknown): boolean { if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) return false; const parsed = new Date(`${value}T00:00:00Z`); return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; }
function identifier(value: unknown): boolean { return typeof value === "string" && /^[a-z0-9][a-z0-9._:-]{0,99}$/.test(value); }
function positiveId(value: unknown): boolean { return typeof value === "string" && /^[1-9]\d*$/.test(value); }
function positiveInteger(value: unknown): boolean { return Number.isSafeInteger(value) && Number(value) > 0; }
function finitePositive(value: unknown): boolean { return typeof value === "number" && Number.isFinite(value) && value > 0; }
function finiteNonnegative(value: unknown): boolean { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function bounded(value: unknown, max: number): boolean { return typeof value === "string" && value.trim().length > 0 && value.length <= max; }
function hash(value: unknown): boolean { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function instant(value: unknown): boolean { return typeof value === "string" && isRfc3339DateTime(value) && Number.isFinite(Date.parse(value)); }
function optionalUrl(value: unknown): boolean { if (value === null) return true; if (typeof value !== "string" || value.length > 2000) return false; try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; } }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: string[], label: string, errors: string[]): void { const allowed = new Set(keys); for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${label}.${key} is not allowed`); }
function invalid(errors: string[]): { ok: false; errors: string[] } { return { ok: false, errors }; }
