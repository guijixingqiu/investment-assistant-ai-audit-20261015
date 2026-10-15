import { isRfc3339DateTime } from "./factMetadata.js";
import { canonicalJson } from "./decisionContextBrowser.js";
import { RESEARCH_EVENT_KINDS, type ResearchEventKind } from "./researchEvent.js";

export const GEELY_SALES_MONITOR_SCHEMA_VERSION = "2026-07-25.geely-sales-monitor.v1";
export const GEELY_SALES_ROLES = ["target", "peer", "industry"] as const;
export const GEELY_SALES_LEVELS = ["issuer", "brand", "model", "industry"] as const;
export const GEELY_SALES_PERIOD_KINDS = ["month", "year_to_date"] as const;
export const GEELY_SALES_METRICS = ["sales_volume", "average_transaction_price"] as const;
export const GEELY_SALES_PROPULSIONS = ["all", "new_energy"] as const;
export const GEELY_SALES_GEOGRAPHIES = ["global", "china", "export"] as const;
export const GEELY_SALES_CHANNELS = ["wholesale", "retail", "deliveries", "registrations"] as const;
export const GEELY_SALES_UNITS = ["vehicles", "CNY_per_vehicle"] as const;

export interface GeelySalesInputObservation {
  eventId: string;
  entityId: string;
  entityName: string;
  entityRole: (typeof GEELY_SALES_ROLES)[number];
  entityLevel: (typeof GEELY_SALES_LEVELS)[number];
  issuerId: string | null;
  periodKind: (typeof GEELY_SALES_PERIOD_KINDS)[number];
  period: string;
  metric: (typeof GEELY_SALES_METRICS)[number];
  propulsion: (typeof GEELY_SALES_PROPULSIONS)[number];
  geography: (typeof GEELY_SALES_GEOGRAPHIES)[number];
  channel: (typeof GEELY_SALES_CHANNELS)[number];
  unit: (typeof GEELY_SALES_UNITS)[number];
  definitionKey: string;
  value: number;
}

export interface CreateGeelySalesMonitorRequest {
  membershipVersion: number;
  period: string;
  observations: GeelySalesInputObservation[];
  idempotencyKey: string;
}

export interface GeelySalesSourceEvent {
  eventId: string;
  eventVersion: number;
  eventFingerprint: string;
  symbol: string;
  eventKind: ResearchEventKind;
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

export interface GeelySalesObservation extends GeelySalesInputObservation {
  sourceEvent: GeelySalesSourceEvent;
}

export interface GeelySalesComparison {
  id: string;
  status: "comparable" | "missing" | "incomparable" | "zero_baseline";
  currentPeriod: string;
  referencePeriod: string;
  currentValue: number | null;
  referenceValue: number | null;
  percentChange: number | null;
  reason: string;
}

export interface GeelySalesRatio {
  id: string;
  status: "comparable" | "missing" | "incomparable" | "zero_denominator";
  currentValue: number | null;
  priorYearValue: number | null;
  changePercentagePoints: number | null;
  boundary: string;
}

export interface GeelySalesImpact {
  signal: "supports" | "weakens" | "mixed" | "unknown";
  basis: string[];
  unknowns: string[];
}

export interface GeelySalesAssessment {
  status: "comparable" | "incomparable" | "insufficient";
  trendConclusionAllowed: boolean;
  blockers: string[];
  comparisons: GeelySalesComparison[];
  ratios: GeelySalesRatio[];
  productMix: GeelySalesRatio[];
  peerGrowth: Array<{ entityId: string; entityName: string; yoyPercent: number | null; status: GeelySalesComparison["status"] }>;
  movement: "industry_common_up" | "industry_common_down" | "company_specific_outperformance" | "company_specific_underperformance" | "mixed" | "unknown";
  impacts: {
    revenue: GeelySalesImpact;
    grossMargin: GeelySalesImpact;
    marketShare: GeelySalesImpact;
    valuation: GeelySalesImpact;
    thesis: GeelySalesImpact;
  };
}

export interface GeelySalesMonitorData {
  id: string;
  runVersion: number;
  runFingerprint: string;
  membershipId: string;
  membershipVersion: number;
  market: "HK";
  code: "00175";
  symbol: "HK.00175";
  period: string;
  observations: GeelySalesObservation[];
  assessment: GeelySalesAssessment;
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

export function validateCreateGeelySalesMonitorRequest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return invalid(["request must be an object"]);
  exact(value, ["membershipVersion", "period", "observations", "idempotencyKey"], "request", errors);
  if (!positiveInteger(value.membershipVersion)) errors.push("membershipVersion must be a positive integer");
  if (!month(value.period)) errors.push("period must be YYYY-MM");
  if (!bounded(value.idempotencyKey, 200)) errors.push("idempotencyKey must be a non-empty string of at most 200 characters");
  if (!Array.isArray(value.observations) || value.observations.length < 1 || value.observations.length > 200) {
    errors.push("observations must contain 1-200 rows");
  } else {
    value.observations.forEach((item, index) => validateInputObservation(item, value.period, `observations[${index}]`, errors));
    const identities = value.observations.filter(record).map(observationIdentity);
    if (new Set(identities).size !== identities.length) errors.push("observations contain duplicate or conflicting logical identities");
  }
  return errors.length ? invalid(errors) : { ok: true };
}

export function buildGeelySalesAssessment(observations: GeelySalesObservation[], period: string): GeelySalesAssessment {
  const blockers: string[] = [];
  const previous = shiftMonth(period, -1);
  const priorYear = shiftMonth(period, -12);
  const targetRows = observations.filter((item) => item.entityRole === "target" && item.entityLevel === "issuer");
  const currentTotal = one(targetRows.filter((item) => current(item, period, "sales_volume", "all", "global")), "target current total sales", blockers);
  const targetId = currentTotal?.entityId ?? targetRows[0]?.entityId ?? null;
  const selectTarget = (
    metric: GeelySalesInputObservation["metric"],
    propulsion: GeelySalesInputObservation["propulsion"],
    geography: GeelySalesInputObservation["geography"],
    kind: GeelySalesInputObservation["periodKind"] = "month"
  ) =>
    one(targetRows.filter((item) => item.entityId === targetId && item.periodKind === kind && item.period === period
      && item.metric === metric && item.propulsion === propulsion && item.geography === geography), `target ${kind} ${propulsion} ${geography} ${metric}`, blockers);
  const total = currentTotal;
  const nev = selectTarget("sales_volume", "new_energy", "global");
  const exports = selectTarget("sales_volume", "all", "export");
  const price = selectTarget("average_transaction_price", "all", "china");
  const ytdTotal = selectTarget("sales_volume", "all", "global", "year_to_date");
  const ytdNev = selectTarget("sales_volume", "new_energy", "global", "year_to_date");
  const ytdExports = selectTarget("sales_volume", "all", "export", "year_to_date");
  let arithmeticConflict = false;
  const requireAtLeast = (larger: GeelySalesObservation | null, smaller: GeelySalesObservation | null, label: string) => {
    if (larger && smaller && larger.value < smaller.value) {
      blockers.push(label);
      arithmeticConflict = true;
    }
  };
  requireAtLeast(ytdTotal, total, "year-to-date total sales cannot be below current-month total sales");
  requireAtLeast(ytdNev, nev, "year-to-date new-energy sales cannot be below current-month new-energy sales");
  requireAtLeast(ytdExports, exports, "year-to-date exports cannot be below current-month exports");
  requireAtLeast(ytdTotal, ytdNev, "year-to-date new-energy sales cannot exceed year-to-date total sales");
  requireAtLeast(ytdTotal, ytdExports, "year-to-date exports cannot exceed year-to-date total sales");
  const comparisons = [
    compare("geely_total_sales_mom", total, observations, "month", previous),
    compare("geely_total_sales_yoy", total, observations, "month", priorYear),
    compare("geely_total_sales_ytd_yoy", ytdTotal, observations, "year_to_date", priorYear),
    compare("geely_nev_sales_mom", nev, observations, "month", previous),
    compare("geely_nev_sales_yoy", nev, observations, "month", priorYear),
    compare("geely_nev_sales_ytd_yoy", ytdNev, observations, "year_to_date", priorYear),
    compare("geely_exports_mom", exports, observations, "month", previous),
    compare("geely_exports_yoy", exports, observations, "month", priorYear),
    compare("geely_exports_ytd_yoy", ytdExports, observations, "year_to_date", priorYear),
    compare("geely_average_price_mom", price, observations, "month", previous),
    compare("geely_average_price_yoy", price, observations, "month", priorYear)
  ];
  const ratios = [
    ratio("geely_nev_share", nev, total, observations, priorYear, "issuer sales with identical channel, unit and definition"),
    ratio("geely_export_share", exports, total, observations, priorYear, "issuer exports divided by issuer global sales")
  ];
  const mixRows = observations.filter((item) => item.entityRole === "target" && ["brand", "model"].includes(item.entityLevel)
    && item.issuerId === targetId && item.periodKind === "month" && item.period === period && item.metric === "sales_volume");
  const productMix = mixRows.map((item) => ratio(`product_mix:${item.entityId}`, item, item.propulsion === "new_energy" ? nev : total, observations, priorYear, "supplied product row divided by the compatible Geely issuer total"));
  const peerRows = observations.filter((item) => item.entityRole === "peer" && item.entityLevel === "issuer"
    && current(item, period, "sales_volume", "new_energy", "global") && compatible(item, nev));
  const peerGrowth = peerRows.map((item) => {
    const result = compare(`peer:${item.entityId}:nev_sales_yoy`, item, observations, "month", priorYear);
    comparisons.push(result);
    return { entityId: item.entityId, entityName: item.entityName, yoyPercent: result.percentChange, status: result.status };
  });
  ratios.push(peerSetRatio(nev, peerRows, observations, priorYear));
  const industry = one(observations.filter((item) => item.entityRole === "industry" && item.entityLevel === "industry"
    && current(item, period, "sales_volume", "new_energy", "global")), "industry current new-energy sales", []);
  if (industry) ratios.push(ratio("industry_nev_share", nev, industry, observations, priorYear, "Geely supplied NEV sales divided by a definition-compatible supplied industry total"));
  const requiredComparisons = comparisons.filter((item) => !item.id.includes("average_price") && !item.id.startsWith("peer:"));
  const requiredRatios = ratios.filter((item) => item.id !== "industry_nev_share");
  for (const item of [...requiredComparisons, ...requiredRatios, ...productMix]) {
    if (item.status !== "comparable") blockers.push(`${item.id}: ${"reason" in item ? item.reason : item.status}`);
  }
  if (peerGrowth.length < 1) blockers.push("at least one definition-compatible mainstream peer is required");
  if (productMix.length < 1) blockers.push("at least one definition-compatible Geely brand or model row is required");
  const incomparable = [...comparisons, ...ratios, ...productMix].some((item) => item.status === "incomparable");
  const status = incomparable || arithmeticConflict ? "incomparable" : blockers.length ? "insufficient" : "comparable";
  const revenue = impactFrom(comparisons, ["geely_total_sales_yoy", "geely_total_sales_ytd_yoy"], ["price, incentives and revenue recognition are not sales-volume facts"]);
  const priceYoy = comparisons.find((item) => item.id === "geely_average_price_yoy");
  const grossMargin = impactFromValues(priceYoy?.status === "comparable" ? [priceYoy.percentChange] : [], ["cost, incentives, product mix and accounting margin are not supplied"]);
  const peerShare = ratios.find((item) => item.id === "supplied_peer_set_nev_share");
  const marketShare = impactFromValues(peerShare?.status === "comparable" ? [peerShare.changePercentagePoints] : [], ["the supplied peer set is not an authoritative full-market universe"]);
  const sourceSignals = [...new Set(observations.map((item) => item.sourceEvent.hypothesisImpact).filter((item) => item !== "unknown"))];
  const thesisSignal = sourceSignals.length === 1 ? sourceSignals[0] : sourceSignals.length > 1 ? "mixed" : "unknown";
  return {
    status,
    trendConclusionAllowed: status === "comparable",
    blockers: [...new Set(blockers)].sort(),
    comparisons,
    ratios,
    productMix,
    peerGrowth,
    movement: status === "comparable" ? movement(comparisons, peerGrowth) : "unknown",
    impacts: {
      revenue,
      grossMargin,
      marketShare,
      valuation: { signal: "unknown", basis: [], unknowns: ["valuation scenario or market-implied expectation is not supplied"] },
      thesis: { signal: thesisSignal, basis: sourceSignals.map((item) => `source event impact: ${item}`), unknowns: sourceSignals.length ? [] : ["source events do not state a directional thesis impact"] }
    }
  };
}

export function validateGeelySalesMonitorData(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return invalid(["monitor data must be an object"]);
  exact(value, ["id", "runVersion", "runFingerprint", "membershipId", "membershipVersion", "market", "code", "symbol", "period", "observations", "assessment", "createdAt", "safety"], "monitor", errors);
  if (!positiveId(value.id) || !positiveInteger(value.runVersion) || !positiveId(value.membershipId) || !positiveInteger(value.membershipVersion)) errors.push("monitor identity is invalid");
  if (typeof value.runFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.runFingerprint)) errors.push("runFingerprint is invalid");
  if (value.market !== "HK" || value.code !== "00175" || value.symbol !== "HK.00175" || !month(value.period)) errors.push("monitor target or period is invalid");
  const observations = Array.isArray(value.observations) ? value.observations : [];
  observations.forEach((item, index) => validateOutputObservation(item, value.period, `observations[${index}]`, errors));
  if (!observations.length || canonicalJson(value.assessment) !== canonicalJson(buildGeelySalesAssessment(observations as GeelySalesObservation[], String(value.period)))) errors.push("assessment does not deterministically recompute");
  if (!instant(value.createdAt)) errors.push("createdAt is invalid");
  else {
    const createdAt = Date.parse(String(value.createdAt));
    if (String(value.period) > String(value.createdAt).slice(0, 7)
      || observations.some((item) => record(item) && record(item.sourceEvent) && Date.parse(String(item.sourceEvent.capturedAt)) > createdAt)) {
      errors.push("monitor period or source capture time is in the future");
    }
  }
  if (!record(value.safety) || canonicalJson(value.safety) !== canonicalJson(safety())) errors.push("monitor safety boundary is invalid");
  return errors.length ? invalid(errors) : { ok: true };
}

export function geelySalesSafety(): GeelySalesMonitorData["safety"] { return safety(); }

function compare(id: string, row: GeelySalesObservation | null, rows: GeelySalesObservation[], kind: GeelySalesInputObservation["periodKind"], referencePeriod: string): GeelySalesComparison {
  if (!row) return { id, status: "missing", currentPeriod: "", referencePeriod, currentValue: null, referenceValue: null, percentChange: null, reason: "current observation is missing or ambiguous" };
  const exactRows = rows.filter((item) => item.periodKind === kind && item.period === referencePeriod && sameSeries(item, row));
  if (exactRows.length === 1) {
    const reference = exactRows[0].value;
    if (reference === 0) return { id, status: "zero_baseline", currentPeriod: row.period, referencePeriod, currentValue: row.value, referenceValue: 0, percentChange: null, reason: "reference value is zero" };
    return { id, status: "comparable", currentPeriod: row.period, referencePeriod, currentValue: row.value, referenceValue: reference, percentChange: round((row.value / reference - 1) * 100), reason: "exact period definition match" };
  }
  const near = rows.some((item) => item.periodKind === kind && item.period === referencePeriod && sameSemantic(item, row));
  return { id, status: near ? "incomparable" : "missing", currentPeriod: row.period, referencePeriod, currentValue: row.value, referenceValue: null, percentChange: null, reason: near ? "reference exists with a different channel, unit, or definition" : "reference observation is missing" };
}

function ratio(id: string, numerator: GeelySalesObservation | null, denominator: GeelySalesObservation | null, rows: GeelySalesObservation[], priorYear: string, boundary: string): GeelySalesRatio {
  if (!numerator || !denominator) return ratioResult(id, "missing", null, null, null, boundary);
  if (!compatible(numerator, denominator)) return ratioResult(id, "incomparable", null, null, null, boundary);
  if (denominator.value === 0) return ratioResult(id, "zero_denominator", null, null, null, boundary);
  const currentValue = round(numerator.value / denominator.value * 100);
  if (numerator.value > denominator.value) return ratioResult(id, "incomparable", null, null, null, `${boundary}; numerator exceeds denominator`);
  const priorNumerator = rows.find((item) => item.periodKind === numerator.periodKind && item.period === priorYear && sameSeries(item, numerator));
  const priorDenominator = rows.find((item) => item.periodKind === denominator.periodKind && item.period === priorYear && sameSeries(item, denominator));
  if (!priorNumerator || !priorDenominator) return ratioResult(id, "missing", currentValue, null, null, boundary);
  if (priorDenominator.value === 0) return ratioResult(id, "zero_denominator", currentValue, null, null, boundary);
  if (priorNumerator.value > priorDenominator.value) return ratioResult(id, "incomparable", currentValue, null, null, `${boundary}; prior-year numerator exceeds denominator`);
  const prior = round(priorNumerator.value / priorDenominator.value * 100);
  return ratioResult(id, "comparable", currentValue, prior, round(currentValue - prior), boundary);
}

function peerSetRatio(target: GeelySalesObservation | null, peers: GeelySalesObservation[], rows: GeelySalesObservation[], priorYear: string): GeelySalesRatio {
  if (!target || !peers.length) return ratioResult("supplied_peer_set_nev_share", "missing", null, null, null, "bounded supplied peer set; not full-market share");
  const currentTotal = target.value + peers.reduce((sum, item) => sum + item.value, 0);
  const priorRows = [target, ...peers].map((row) => rows.find((item) => item.periodKind === "month" && item.period === priorYear && sameSeries(item, row)));
  if (!currentTotal) return ratioResult("supplied_peer_set_nev_share", "zero_denominator", null, null, null, "bounded supplied peer set; not full-market share");
  const currentValue = round(target.value / currentTotal * 100);
  if (priorRows.some((item) => !item)) return ratioResult("supplied_peer_set_nev_share", "missing", currentValue, null, null, "bounded supplied peer set; not full-market share");
  const priorTotal = priorRows.reduce((sum, item) => sum + (item?.value ?? 0), 0);
  if (!priorTotal) return ratioResult("supplied_peer_set_nev_share", "zero_denominator", currentValue, null, null, "bounded supplied peer set; not full-market share");
  const priorValue = round((priorRows[0]?.value ?? 0) / priorTotal * 100);
  return ratioResult("supplied_peer_set_nev_share", "comparable", currentValue, priorValue, round(currentValue - priorValue), "bounded supplied peer set; not full-market share");
}

function validateInputObservation(value: unknown, runPeriod: unknown, label: string, errors: string[]): void {
  if (!record(value)) { errors.push(`${label} must be an object`); return; }
  exact(value, ["eventId", "entityId", "entityName", "entityRole", "entityLevel", "issuerId", "periodKind", "period", "metric", "propulsion", "geography", "channel", "unit", "definitionKey", "value"], label, errors);
  if (!positiveId(value.eventId) || !identifier(value.entityId) || !bounded(value.entityName, 200) || !GEELY_SALES_ROLES.includes(value.entityRole as never) || !GEELY_SALES_LEVELS.includes(value.entityLevel as never)) errors.push(`${label} entity identity is invalid`);
  if (value.entityRole === "industry" ? value.entityLevel !== "industry" || value.issuerId !== null : value.entityLevel === "industry" || !identifier(value.issuerId)) errors.push(`${label} role, level, and issuer binding are invalid`);
  if (value.entityLevel === "issuer" && value.issuerId !== value.entityId) errors.push(`${label} issuer rows must self-bind issuerId`);
  if (!GEELY_SALES_PERIOD_KINDS.includes(value.periodKind as never) || !month(value.period) || !allowedPeriod(String(runPeriod), String(value.period), String(value.periodKind))) errors.push(`${label} period is outside the current, prior-month, or prior-year comparison window`);
  if (!GEELY_SALES_METRICS.includes(value.metric as never) || !GEELY_SALES_PROPULSIONS.includes(value.propulsion as never) || !GEELY_SALES_GEOGRAPHIES.includes(value.geography as never) || !GEELY_SALES_CHANNELS.includes(value.channel as never) || !GEELY_SALES_UNITS.includes(value.unit as never) || !bounded(value.definitionKey, 200)) errors.push(`${label} dimensions are invalid`);
  if (value.metric === "sales_volume" ? value.unit !== "vehicles" || !Number.isSafeInteger(value.value) || Number(value.value) < 0 : value.unit !== "CNY_per_vehicle" || !finitePositive(value.value) || value.periodKind !== "month") errors.push(`${label} metric value, unit, or period kind is invalid`);
}

function validateOutputObservation(value: unknown, runPeriod: unknown, label: string, errors: string[]): void {
  if (!record(value)) { errors.push(`${label} must be an object`); return; }
  validateInputObservation(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "sourceEvent")), runPeriod, label, errors);
  if (!record(value.sourceEvent)) { errors.push(`${label}.sourceEvent is required`); return; }
  exact(value.sourceEvent, ["eventId", "eventVersion", "eventFingerprint", "symbol", "eventKind", "materialId", "materialFingerprint", "sourceType", "sourceUrl", "publishedAt", "capturedAt", "validUntil", "rightsStatus", "verificationStatus", "sourceVersion", "revision", "keyVariable", "hypothesisImpact"], `${label}.sourceEvent`, errors);
  const source = value.sourceEvent;
  if (source.eventId !== value.eventId || !positiveInteger(source.eventVersion) || !hash(source.eventFingerprint) || !/^HK\.\d{5}$/.test(String(source.symbol)) || !RESEARCH_EVENT_KINDS.includes(source.eventKind as ResearchEventKind) || !positiveId(source.materialId) || !hash(source.materialFingerprint)) errors.push(`${label} source event identity is invalid`);
  if (!bounded(source.sourceType, 200) || !optionalUrl(source.sourceUrl) || !instant(source.publishedAt) || !instant(source.capturedAt) || !instant(source.validUntil)
    || Date.parse(String(source.publishedAt)) > Date.parse(String(source.capturedAt))
    || Date.parse(String(source.validUntil)) <= Date.parse(String(source.capturedAt))) errors.push(`${label} source event timeline is invalid`);
  if (!["user_provided", "authorized_public"].includes(String(source.rightsStatus)) || source.verificationStatus !== "verified" || !bounded(source.sourceVersion, 200) || !positiveInteger(source.revision) || source.keyVariable !== "new_energy_vehicle_sales" || !["supports", "weakens", "unknown"].includes(String(source.hypothesisImpact))) errors.push(`${label} source event is not eligible`);
}

function current(item: GeelySalesObservation, period: string, metric: GeelySalesInputObservation["metric"], propulsion: GeelySalesInputObservation["propulsion"], geography: GeelySalesInputObservation["geography"]): boolean { return item.periodKind === "month" && item.period === period && item.metric === metric && item.propulsion === propulsion && item.geography === geography; }
function one(rows: GeelySalesObservation[], label: string, blockers: string[]): GeelySalesObservation | null { if (rows.length === 1) return rows[0]; blockers.push(`${label} is ${rows.length ? "ambiguous" : "missing"}`); return null; }
function sameSemantic(a: GeelySalesInputObservation, b: GeelySalesInputObservation): boolean { return a.entityId === b.entityId && a.entityRole === b.entityRole && a.entityLevel === b.entityLevel && a.issuerId === b.issuerId && a.metric === b.metric && a.propulsion === b.propulsion && a.geography === b.geography; }
function sameSeries(a: GeelySalesInputObservation, b: GeelySalesInputObservation): boolean { return sameSemantic(a, b) && a.channel === b.channel && a.unit === b.unit && a.definitionKey === b.definitionKey; }
function compatible(a: GeelySalesObservation | null, b: GeelySalesObservation | null): boolean { return Boolean(a && b && a.channel === b.channel && a.unit === b.unit && a.definitionKey === b.definitionKey && a.periodKind === b.periodKind && a.period === b.period); }
function observationIdentity(value: Record<string, unknown>): string { return ["entityId", "entityRole", "entityLevel", "issuerId", "periodKind", "period", "metric", "propulsion", "geography", "channel", "unit", "definitionKey"].map((key) => String(value[key])).join("|"); }
function ratioResult(id: string, status: GeelySalesRatio["status"], currentValue: number | null, priorYearValue: number | null, changePercentagePoints: number | null, boundary: string): GeelySalesRatio { return { id, status, currentValue, priorYearValue, changePercentagePoints, boundary }; }
function impactFrom(comparisons: GeelySalesComparison[], ids: string[], unknowns: string[]): GeelySalesImpact { return impactFromValues(ids.map((id) => comparisons.find((item) => item.id === id)?.percentChange ?? null), unknowns); }
function impactFromValues(values: Array<number | null>, unknowns: string[]): GeelySalesImpact { const usable = values.filter((value): value is number => value !== null); const positive = usable.some((value) => value > 0); const negative = usable.some((value) => value < 0); return { signal: !usable.length ? "unknown" : positive && negative ? "mixed" : positive ? "supports" : negative ? "weakens" : "unknown", basis: usable.map((value) => `${value}% deterministic change`), unknowns }; }
function movement(comparisons: GeelySalesComparison[], peers: GeelySalesAssessment["peerGrowth"]): GeelySalesAssessment["movement"] { const target = comparisons.find((item) => item.id === "geely_nev_sales_yoy")?.percentChange; const peer = peers.map((item) => item.yoyPercent).filter((item): item is number => item !== null); if (target === null || target === undefined || peer.length < 2) return "unknown"; const average = peer.reduce((sum, item) => sum + item, 0) / peer.length; if (target > 0 && average > 0) return "industry_common_up"; if (target < 0 && average < 0) return "industry_common_down"; if (target > 0 && average <= 0) return "company_specific_outperformance"; if (target < 0 && average >= 0) return "company_specific_underperformance"; return "mixed"; }
function shiftMonth(value: string, offset: number): string { const [year, monthValue] = value.split("-").map(Number); const date = new Date(Date.UTC(year, monthValue - 1 + offset, 1)); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; }
function allowedPeriod(run: string, value: string, kind: string): boolean { return kind === "month" ? [run, shiftMonth(run, -1), shiftMonth(run, -12)].includes(value) : [run, shiftMonth(run, -12)].includes(value); }
function safety(): GeelySalesMonitorData["safety"] { return { advisoryOnly: true, createsOrder: false, createsTrade: false, mutatesCash: false, writesFee: false, mutatesPosition: false, callsBroker: false, productionWrite: false }; }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000; }
function month(value: unknown): boolean { return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value); }
function identifier(value: unknown): boolean { return typeof value === "string" && /^[a-z0-9][a-z0-9._:-]{0,99}$/.test(value); }
function positiveId(value: unknown): boolean { return typeof value === "string" && /^[1-9]\d*$/.test(value); }
function positiveInteger(value: unknown): boolean { return Number.isSafeInteger(value) && Number(value) > 0; }
function finitePositive(value: unknown): boolean { return typeof value === "number" && Number.isFinite(value) && value > 0; }
function bounded(value: unknown, max: number): boolean { return typeof value === "string" && value.trim().length > 0 && value.length <= max; }
function hash(value: unknown): boolean { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function instant(value: unknown): boolean { return typeof value === "string" && isRfc3339DateTime(value) && Number.isFinite(Date.parse(value)); }
function optionalUrl(value: unknown): boolean { if (value === null) return true; if (typeof value !== "string" || value.length > 2000) return false; try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; } }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: string[], label: string, errors: string[]): void { const allowed = new Set(keys); for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${label}.${key} is not allowed`); }
function invalid(errors: string[]): { ok: false; errors: string[] } { return { ok: false, errors }; }
