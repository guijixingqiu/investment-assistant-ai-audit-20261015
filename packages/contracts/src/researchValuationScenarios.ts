import {
  ANNUAL_ADJUSTED_NET_ASSET_CALCULATION_VERSION,
  ANNUAL_ADJUSTED_NET_ASSET_VALUE_FORMULA,
  ANNUAL_VALUATION_CALCULATION_VERSION,
  ANNUAL_VALUATION_PRESENT_VALUE_FORMULA,
  calculateAnnualValuationScenarioGrid,
  annualValuationMethodId,
  type AnnualValuationScenarioInput,
  validateAnnualValuationScenarioInput,
  validateNewAnnualValuationScenarioInput
} from "./annualValuationQuantWorkbench.js";
import { RESEARCH_FUNDAMENTALS_SCHEMA_VERSION, type ResearchFundamentalValueData } from "./researchFundamentals.js";
import { isRfc3339DateTime } from "./factMetadata.js";
import type {FutuProviderValuationBasis} from "./researchValuationProvider.js";
import { validResearchValuationIssuerBasisBinding, type ResearchValuationIssuerBasisBinding } from "./researchValuationIssuerBasis.js";
import { canonicalJson } from "./decisionContextBrowser.js";
import { calculateFcffScenario, fcffCreateRequestErrors, fcffScenarioInputErrors, fcffSourceSelectionErrors,
  fcffProviderCreateRequestErrors, fcffProviderReferenceErrors,
  fcffPublishedHongKongDay,
  FCFF_CALCULATION_VERSION, FCFF_METHOD_ID, FCFF_HISTORICAL_METRICS,
  FCFF_BRIDGE_METRICS, FCFF_NONOPERATING_METRICS, FCFF_OTHER_CLAIM_METRICS,
  FCFF_WORKING_CAPITAL_METRICS, type ResearchFcffScenarioSetData,
  type ResearchProviderFcffScenarioSetData }
  from "./researchValuationFcff.js";

export const RESEARCH_VALUATION_SCENARIOS_SCHEMA_VERSION =
  "2026-07-30.research-valuation-scenarios.v1";

export interface CreateResearchValuationScenarioRequest {
  membershipVersion: number;
  symbol: string;
  anchorValueId: string;
  replacesScenarioSetId: string | null;
  assumptions: AnnualValuationScenarioInput;
  ownerConfirmed: true;
  idempotencyKey: string;
  issuerBasis?: ResearchValuationIssuerBasisBinding;
}

export interface ResearchValuationCalculation {
  issuerBasis?: ResearchValuationIssuerBasisBinding;
  method: {
    id: "discounted_forward_metric_multiple_user_scenario" | "adjusted_net_asset_value_user_scenario";
    calculationVersion: typeof ANNUAL_VALUATION_CALCULATION_VERSION | typeof ANNUAL_ADJUSTED_NET_ASSET_CALCULATION_VERSION;
    presentValueFormula: typeof ANNUAL_VALUATION_PRESENT_VALUE_FORMULA | typeof ANNUAL_ADJUSTED_NET_ASSET_VALUE_FORMULA;
    rounding: "decimal_places_6";
    applicability?: {
      ownerConfirmed: true;
      companyDataBasis: "forward_operating_metric_per_share" | "reported_balance_sheet_net_assets_per_share";
      requiredAnchorMetrics: Array<"revenue" | "profit_attributable_to_owners" | "total_assets" | "total_liabilities">;
      limitation: string;
      pairedAnchorValueId?: string;
    };
  };
  projectedMetricPerShare: number;
  scenarioPresentValuePerShare: number;
  diagonal: Array<{
    scenario: "bear" | "base" | "bull";
    annualGrowthRate: number;
    terminalMultiple: number;
    presentValuePerShare: number;
  }>;
  matrix: {
    growthRates: number[];
    terminalMultiples: number[];
    cells: Array<{
      annualGrowthRate: number;
      terminalMultiple: number;
      presentValuePerShare: number;
    }>;
  };
  valueRange?: {
    low: number;
    high: number;
    interpretation: "research_scenario_range_not_target_price";
  };
}

export interface ResearchValuationScenarioSetData {
  id: string;
  membershipId: string;
  membershipVersionAtWrite: number;
  symbol: string;
  revision: number;
  replacesScenarioSetId: string | null;
  scenarioState: "current" | "replaced";
  recomputable: boolean;
  invalidatedBy: Array<
    | "scenario_replaced"
    | "membership_version_changed"
    | "membership_archived"
    | "anchor_replaced"
    | "anchor_source_superseded"
    | "anchor_source_review_required"
    | "anchor_source_original_unavailable"
    | "anchor_source_stale"
    | "anchor_not_reported"
    | "anchor_not_comparable"
    | "anchor_metric_ineligible"
    | "method_anchor_inapplicable"
    | "nav_pair_unbound"
    | "nav_pair_unavailable"
    | "issuer_basis_unavailable"
  >;
  anchor: ResearchFundamentalValueData & {
    anchorRole: "cited_context_only_not_calculation_input" | "issuer_nav_source_draft_input";
  };
  anchorOriginalAvailability: "available" | "unavailable" | "unknown";
  issuerBasisCurrentness?: "available" | "unavailable";
  pairedAnchor?: (ResearchFundamentalValueData & {
    anchorRole: "cited_context_only_not_calculation_input" | "issuer_nav_source_draft_input";
  }) | null;
  assumptions: {
    authority: "owner";
    derivation: "manual_not_derived_from_citation" | "issuer_nav_source_draft_owner_confirmed";
    values: AnnualValuationScenarioInput;
  };
  calculation: ResearchValuationCalculation;
  safety: {
    advisoryOnly: true;
    forecast: false;
    recommendation: false;
    automaticSignal: false;
    createsOrder: false;
    callsBroker: false;
    mutatesOfficialPortfolio: false;
  };
  createdAt: string;
}

export interface ResearchValuationScenariosEnvelope {
  schemaVersion: typeof RESEARCH_VALUATION_SCENARIOS_SCHEMA_VERSION;
  generatedAt: string;
  status: "available";
  requestedActorId: string;
  membershipId: string;
  membershipVersion: number;
  membershipState: "tracked" | "paused" | "archived";
  symbol: string;
  fundamentalsSchemaVersion: typeof RESEARCH_FUNDAMENTALS_SCHEMA_VERSION;
  scenarioSets: ResearchValuationScenarioSetData[];
  providerScenarioSets?: ResearchProviderValuationScenarioSetData[];
  fcffScenarioSets?: ResearchFcffScenarioSetData[];
  providerFcffScenarioSets?: ResearchProviderFcffScenarioSetData[];
}

/** Shares the existing scenario table and calculation, but never an issuer fact anchor. */
export interface ResearchProviderValuationScenarioSetData {
  id:string;membershipId:string;membershipVersionAtWrite:number;symbol:string;
  revision:number;replacesScenarioSetId:string|null;scenarioState:"current"|"replaced";
  recomputable:boolean;
  invalidatedBy:Array<"scenario_replaced"|"membership_version_changed"|"membership_archived"
    |"provider_material_changed"|"provider_original_unavailable">;
  basisKind:"provider";providerBasis:FutuProviderValuationBasis;
  assumptions:{authority:"owner";derivation:"provider_reference_owner_confirmed";
    values:AnnualValuationScenarioInput};
  calculation:ResearchValuationCalculation;
  safety:ResearchValuationScenarioSetData["safety"];
  createdAt:string;
}

export function validateCreateResearchValuationScenarioRequest(
  value: unknown
): { ok: true } | { ok: false; errors: string[] } {
  if (!record(value)) return invalid(["request must be an object"]);
  const errors: string[] = [];
  exact(value, [
    "membershipVersion", "symbol", "anchorValueId", "replacesScenarioSetId",
    "assumptions", "ownerConfirmed", "idempotencyKey",
    ...(Object.hasOwn(value, "issuerBasis") ? ["issuerBasis"] : [])
  ], "request", errors);
  if (!Number.isSafeInteger(value.membershipVersion) || Number(value.membershipVersion) <= 0) {
    errors.push("membershipVersion must be a positive integer");
  }
  if (typeof value.symbol !== "string" || !/^HK\.\d{5}$/.test(value.symbol)) {
    errors.push("symbol must be a canonical Hong Kong symbol");
  }
  positiveId(value.anchorValueId, "anchorValueId", errors);
  if (value.replacesScenarioSetId !== null) {
    positiveId(value.replacesScenarioSetId, "replacesScenarioSetId", errors);
  }
  const assumptions = validateNewAnnualValuationScenarioInput(value.assumptions);
  if (!assumptions.ok) errors.push(...assumptions.errors.map((error) => `assumptions.${error}`));
  else if (assumptions.value.metricCurrency === undefined) {
    errors.push("assumptions.metricCurrency must explicitly bind the valuation currency");
  } else if (assumptions.value.shareBasis === undefined) {
    errors.push("assumptions.shareBasis must explicitly bind basic or diluted per-share values");
  }
  if (value.ownerConfirmed !== true) errors.push("ownerConfirmed must be true");
  if (Object.hasOwn(value, "issuerBasis")) {
    if (!validResearchValuationIssuerBasisBinding(value.issuerBasis)
      || !record(value.assumptions)
      || value.assumptions.methodId !== "adjusted_net_asset_value_user_scenario"
      || value.assumptions.shareBasis !== "basic"
      || value.assumptions.netCashPerShare !== 0
      || value.issuerBasis.assetValueId !== value.anchorValueId
        && value.issuerBasis.liabilityValueId !== value.anchorValueId
      || value.issuerBasis.adoptionMode === "source_value"
        && value.assumptions.baseMetricPerShare !== value.issuerBasis.proposedBaseMetricPerShare) {
      errors.push("issuerBasis requires exact NAV sources, basic shares and explicit Owner adoption");
    }
  }
  bounded(value.idempotencyKey, "idempotencyKey", 200, errors);
  return errors.length ? invalid(errors) : { ok: true };
}

export function validateResearchValuationScenariosEnvelope(
  value: unknown
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return invalid(["valuation scenarios envelope must be an object"]);
  exact(value, [
    "schemaVersion", "generatedAt", "status", "requestedActorId", "membershipId",
    "membershipVersion", "membershipState", "symbol", "fundamentalsSchemaVersion", "scenarioSets",
    ...(Object.hasOwn(value,"providerScenarioSets")?["providerScenarioSets"]:[]),
    ...(Object.hasOwn(value,"fcffScenarioSets")?["fcffScenarioSets"]:[]),
    ...(Object.hasOwn(value,"providerFcffScenarioSets")?["providerFcffScenarioSets"]:[])
  ], "envelope", errors);
  if (value.schemaVersion !== RESEARCH_VALUATION_SCENARIOS_SCHEMA_VERSION) errors.push("schemaVersion is invalid");
  if (typeof value.generatedAt !== "string" || !isRfc3339DateTime(value.generatedAt)) errors.push("generatedAt is invalid");
  if (value.status !== "available") errors.push("status is invalid");
  if (typeof value.requestedActorId !== "string" || value.requestedActorId.length === 0) errors.push("requestedActorId is invalid");
  positiveId(value.membershipId, "membershipId", errors);
  if (!Number.isSafeInteger(value.membershipVersion) || Number(value.membershipVersion) <= 0) errors.push("membershipVersion is invalid");
  if (!["tracked", "paused", "archived"].includes(String(value.membershipState))) errors.push("membershipState is invalid");
  if (typeof value.symbol !== "string" || !/^HK\.\d{5}$/.test(value.symbol)) errors.push("symbol is invalid");
  if (value.fundamentalsSchemaVersion !== RESEARCH_FUNDAMENTALS_SCHEMA_VERSION) errors.push("fundamentalsSchemaVersion is invalid");
  if (!Array.isArray(value.scenarioSets)) {
    errors.push("scenarioSets must be an array");
  } else {
    const ids = new Set<string>();
    value.scenarioSets.forEach((scenario, index) => {
      validateResearchValuationScenarioSet(scenario, value, index, errors);
      if (record(scenario) && typeof scenario.id === "string") {
        if (ids.has(scenario.id)) errors.push("scenario set ids must be unique");
        ids.add(scenario.id);
      }
    });
  }
  if(Object.hasOwn(value,"providerScenarioSets")){
    if(!Array.isArray(value.providerScenarioSets))errors.push("providerScenarioSets must be an array");
    else {
      const ids=new Set<string>();
      value.providerScenarioSets.forEach((scenario,index)=>{
        validateProviderValuationScenarioSet(scenario,value,index,errors);
        if(record(scenario)&&typeof scenario.id==="string"){
          if(ids.has(scenario.id))errors.push("provider scenario ids must be unique");
          ids.add(scenario.id);
        }
      });
    }
  }
  if (Object.hasOwn(value, "fcffScenarioSets")) {
    if (!Array.isArray(value.fcffScenarioSets)) errors.push("fcffScenarioSets must be an array");
    else {
      const ids = new Set<string>();
      value.fcffScenarioSets.forEach((scenario, index) => {
        validateFcffScenarioSet(scenario, value, index, errors);
        if (record(scenario) && typeof scenario.id === "string") {
          if (ids.has(scenario.id)) errors.push("FCFF scenario ids must be unique");
          ids.add(scenario.id);
        }
      });
    }
  }
  if (Object.hasOwn(value, "providerFcffScenarioSets")) {
    if (!Array.isArray(value.providerFcffScenarioSets)) errors.push("providerFcffScenarioSets must be an array");
    else value.providerFcffScenarioSets.forEach((scenario, index) =>
      validateProviderFcffScenarioSet(scenario, value, index, errors));
  }
  return errors.length ? invalid(errors) : { ok: true };
}

export function validateProviderFcffScenarioSet(value: unknown, envelope: Record<string, unknown>,
  index: number, errors: string[]): void {
  const label = `providerFcffScenarioSets[${index}]`;
  if (!record(value)) { errors.push(`${label} invalid`); return; }
  exact(value, ["id", "membershipId", "membershipVersionAtWrite", "symbol", "revision",
    "replacesScenarioSetId", "scenarioState", "recomputable", "invalidatedBy",
    "providerReference", "assumptions", "calculation", "safety", "createdAt"], label, errors);
  if (!validPositiveId(value.id) || value.membershipId !== envelope.membershipId
    || value.symbol !== envelope.symbol || !Number.isSafeInteger(value.membershipVersionAtWrite)
    || Number(value.membershipVersionAtWrite) < 1 || !Number.isSafeInteger(value.revision)
    || Number(value.revision) < 1 || (value.replacesScenarioSetId === null) !== (value.revision === 1)
    || value.replacesScenarioSetId !== null && !validPositiveId(value.replacesScenarioSetId)
    || !["current", "replaced"].includes(String(value.scenarioState))
    || !isRfc3339DateTime(String(value.createdAt))) errors.push(`${label} identity invalid`);
  if (fcffProviderReferenceErrors(value.providerReference).length
    || !record(value.providerReference) || value.providerReference.membershipId !== value.membershipId
    || value.providerReference.membershipVersion !== value.membershipVersionAtWrite
    || value.providerReference.symbol !== value.symbol) errors.push(`${label} provider source invalid`);
  if (!record(value.assumptions) || value.assumptions.authority !== "owner"
    || !record(value.assumptions.values) || !record(value.providerReference)
    || fcffProviderCreateRequestErrors({ basisKind: "provider_fcff",
      membershipVersion: value.membershipVersionAtWrite, symbol: value.symbol,
      replacesScenarioSetId: value.replacesScenarioSetId,
      selection: { financialCaptureId: value.providerReference.financialCaptureId,
        sourceMaterialId: value.providerReference.materialId,
        annualPeriodEnd: value.providerReference.balanceReferenceDate,
        shareReferenceDate: value.providerReference.shareReferenceDate },
      sourceFingerprint: value.providerReference.sourceFingerprint, assumptions: value.assumptions.values,
      bridgeReasons: value.assumptions.bridgeReasons,
      ownerConfirmed: true, idempotencyKey: "historical-provider-fcff" }).length
    || value.assumptions.values.currency !== value.providerReference.currency)
    errors.push(`${label} Owner input invalid`);
  if (!record(value.calculation) || !record(value.assumptions)
    || !record(value.assumptions.values)
    || canonicalJson(calculateFcffScenario(value.assumptions.values as unknown as Parameters<typeof calculateFcffScenario>[0]))
      !== canonicalJson(value.calculation)) errors.push(`${label} calculation mismatch`);
  if (!record(value.safety) || value.safety.advisoryOnly !== true || value.safety.forecast !== true
    || value.safety.recommendation !== false || value.safety.automaticSignal !== false
    || value.safety.createsOrder !== false || value.safety.callsBroker !== false
    || value.safety.mutatesOfficialPortfolio !== false) errors.push(`${label} safety invalid`);
  if (!Array.isArray(value.invalidatedBy) || value.recomputable !== (value.invalidatedBy.length === 0)
    || value.invalidatedBy.some((reason) => !["scenario_replaced", "membership_version_changed",
      "membership_archived", "fcff_source_unavailable", "fcff_source_changed",
      "fcff_calculation_invalid"].includes(String(reason)))) errors.push(`${label} currentness invalid`);
}

export function validateFcffScenarioSet(value: unknown, envelope: Record<string, unknown>, index: number, errors: string[]): void {
  const label = `fcffScenarioSets[${index}]`;
  if (!record(value)) { errors.push(`${label} must be an object`); return; }
  exact(value, ["id", "membershipId", "membershipVersionAtWrite", "symbol", "revision",
    "replacesScenarioSetId", "scenarioState", "recomputable", "invalidatedBy",
    "sourceSelection", "sourceFingerprint", "historicalOriginals", "assumptions",
    "calculation", "safety", "createdAt"], label, errors);
  if (!validPositiveId(value.id) || value.membershipId !== envelope.membershipId
    || value.symbol !== envelope.symbol || !Number.isSafeInteger(value.membershipVersionAtWrite)
    || Number(value.membershipVersionAtWrite) <= 0 || !Number.isSafeInteger(value.revision)
    || Number(value.revision) <= 0 || (value.replacesScenarioSetId !== null
      && !validPositiveId(value.replacesScenarioSetId))
    || (value.replacesScenarioSetId === null) !== (value.revision === 1)
    || !["current", "replaced"].includes(String(value.scenarioState))
    || typeof value.recomputable !== "boolean" || !Array.isArray(value.invalidatedBy)
    || !isRfc3339DateTime(String(value.createdAt))) errors.push(`${label} identity invalid`);
  if (fcffSourceSelectionErrors(value.sourceSelection).length
    || typeof value.sourceFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.sourceFingerprint)
    || !record(value.historicalOriginals) || value.historicalOriginals.sourceFingerprint !== value.sourceFingerprint)
    errors.push(`${label} source binding invalid`);
  if (!fcffSnapshotMatches(value, envelope)) errors.push(`${label} historical original facts invalid`);
  if (!record(value.assumptions) || value.assumptions.authority !== "owner"
    || fcffScenarioInputErrors(value.assumptions.values).length
    || !record(value.assumptions.bridgeClassification)) errors.push(`${label} Owner assumptions invalid`);
  else if (fcffCreateRequestErrors({
    membershipVersion: value.membershipVersionAtWrite, symbol: value.symbol,
    replacesScenarioSetId: value.replacesScenarioSetId,
    sourceSelection: value.sourceSelection, sourceFingerprint: value.sourceFingerprint,
    assumptions: value.assumptions.values,
    bridgeClassification: value.assumptions.bridgeClassification,
    ownerConfirmed: true, idempotencyKey: "historical-fcff-validation"
  }).length) errors.push(`${label} Owner classification invalid`);
  if (!record(value.calculation) || value.calculation.methodId !== FCFF_METHOD_ID
    || value.calculation.calculationVersion !== FCFF_CALCULATION_VERSION
    || !record(value.assumptions) || !record(value.assumptions.values)
    || canonicalJson(calculateFcffScenario(value.assumptions.values as unknown as Parameters<typeof calculateFcffScenario>[0]))
      !== canonicalJson(value.calculation)) errors.push(`${label} calculation mismatch`);
  if (!record(value.safety) || value.safety.advisoryOnly !== true || value.safety.forecast !== true
    || value.safety.recommendation !== false || value.safety.automaticSignal !== false
    || value.safety.createsOrder !== false || value.safety.callsBroker !== false
    || value.safety.mutatesOfficialPortfolio !== false) errors.push(`${label} safety invalid`);
  if (Array.isArray(value.invalidatedBy) && value.recomputable !== (value.invalidatedBy.length === 0))
    errors.push(`${label} currentness inconsistent`);
  if (Array.isArray(value.invalidatedBy)) {
    const lifecycle = [
      value.scenarioState === "replaced" ? "scenario_replaced" : null,
      value.membershipVersionAtWrite !== envelope.membershipVersion ? "membership_version_changed" : null,
      envelope.membershipState === "archived" ? "membership_archived" : null
    ].filter((reason): reason is string => reason !== null);
    if (value.invalidatedBy.slice(0, lifecycle.length).join() !== lifecycle.join()
      || value.invalidatedBy.slice(lifecycle.length).some((reason) => ![
        "fcff_source_unavailable", "fcff_source_changed", "fcff_calculation_invalid"
      ].includes(String(reason)))) errors.push(`${label} currentness reason invalid`);
  }
}

function fcffSnapshotMatches(value: Record<string, unknown>, envelope: Record<string, unknown>): boolean {
  if (!record(value.sourceSelection) || fcffSourceSelectionErrors(value.sourceSelection).length
    || !record(value.historicalOriginals) || !record(value.assumptions)
    || !record(value.assumptions.values) || !record(value.assumptions.values.bridge)
    || !record(value.assumptions.bridgeClassification)) return false;
  const selection = value.sourceSelection, preview = value.historicalOriginals;
  const input = value.assumptions.values, bridge = input.bridge as Record<string, unknown>;
  const classification = value.assumptions.bridgeClassification;
  if (preview.status !== "available" || preview.membershipId !== envelope.membershipId
    || preview.membershipVersion !== value.membershipVersionAtWrite
    || preview.symbol !== envelope.symbol || preview.currency !== input.currency
    || preview.historicalAnnualPeriodEnd !== selection.historicalAnnualPeriodEnd
    || preview.balanceReferenceDate !== selection.balanceReferenceDate
    || typeof input.valuationCutoff !== "string"
    || input.historicalAnnualPeriodEnd !== selection.historicalAnnualPeriodEnd
    || input.balanceReferenceDate !== selection.balanceReferenceDate
    || !Array.isArray(preview.facts) || !Array.isArray(preview.historicalMissingRoles)
    || !Array.isArray(preview.workingCapitalMissing)
    || !Array.isArray(preview.missingBridgeRoles) || preview.missingBridgeRoles.length
    || !record(preview.bridgeReference)
    || !record(selection.historicalValueIds) || !record(selection.bridgeValueIds)
    || !record(selection.workingCapitalValueIds)
    || !Array.isArray(selection.nonOperatingAssetValueIds)
    || !Array.isArray(selection.otherClaimValueIds)) return false;
  const facts = preview.facts.filter(record);
  const valuationCutoff = input.valuationCutoff as string;
  const historical = selection.historicalValueIds;
  const fixedBridge = selection.bridgeValueIds;
  const wc = selection.workingCapitalValueIds;
  const selectedIds = [
    ...Object.values(historical), ...Object.values(fixedBridge),
    ...Object.values(wc).flatMap((ids) => ids as string[]),
    ...selection.nonOperatingAssetValueIds, ...selection.otherClaimValueIds
  ].filter((id): id is string => typeof id === "string");
  if (facts.length !== preview.facts.length || facts.length !== new Set(facts.map((fact) => fact.id)).size
    || facts.some((fact) => {
      const publishedDay = fcffPublishedHongKongDay(fact.publishedAt);
      return !selectedIds.includes(String(fact.id)) || !finiteFcffSourceFact(fact)
        || publishedDay === null || publishedDay > valuationCutoff;
    })) return false;
  const byRole = (role: string) => facts.filter((fact) => fact.role === role);
  const sourceFact = (role: string) => byRole(role)[0];
  const monetary = (fact: Record<string, unknown>, date: string, flow: boolean) =>
    fact.periodEnd === date && fact.periodStart === (flow ? date.slice(0, 4) + "-01-01" : null)
      && fact.scope === "consolidated" && fact.currency === preview.currency;
  for (const [role, metric] of Object.entries(FCFF_HISTORICAL_METRICS)) {
    const chosen = historical[role];
    const selected = byRole(role);
    if (chosen === null) {
      if (selected.length || !preview.historicalMissingRoles.includes(role)) return false;
    } else if (selected.length !== 1 || selected[0].id !== chosen
      || selected[0].metric !== metric
      || !monetary(selected[0], String(selection.historicalAnnualPeriodEnd), true)) {
      if (selected.length || !preview.historicalMissingRoles.includes(role)) return false;
    }
  }
  for (const [role, metric] of Object.entries(FCFF_BRIDGE_METRICS)) {
    const fact = sourceFact(role), selected = byRole(role);
    const shares = role === "issuedShares" || role === "treasuryShares";
    if (selected.length !== 1 || !fact || fact.id !== fixedBridge[role] || fact.metric !== metric
      || fact.periodEnd !== selection.balanceReferenceDate || fact.periodStart !== null
      || fact.scope !== (shares ? "parent_company" : "consolidated")
      || fact.currency !== (shares ? "XXX" : preview.currency)
      || shares && (!Number.isSafeInteger(fact.value) || Number(fact.value) < 0)
      || !shares && Number(fact.value) < 0) return false;
  }
  const grouped = [
    ["nonOperatingAsset", selection.nonOperatingAssetValueIds, FCFF_NONOPERATING_METRICS],
    ["otherClaim", selection.otherClaimValueIds, FCFF_OTHER_CLAIM_METRICS]
  ] as const;
  for (const [role, ids, metrics] of grouped) {
    const selected = byRole(role);
    if (!ids.length || selected.length !== ids.length
      || selected.some((fact) => !ids.includes(fact.id)
        || !(metrics as readonly string[]).includes(String(fact.metric))
        || !monetary(fact, String(selection.balanceReferenceDate), false)
        || Number(fact.value) < 0)
      || new Set(selected.map((fact) => fact.metric)).size !== selected.length) return false;
  }
  const amount = (role: string) => Number(sourceFact(role)?.value);
  const sum = (role: string) => byRole(role).reduce((total, fact) => total + Number(fact.value), 0);
  const reference = preview.bridgeReference;
  const near = (actual: unknown, expected: number) => typeof actual === "number"
    && Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= 0.000001;
  const expectedShares = amount("issuedShares") - amount("treasuryShares");
  if (!Number.isSafeInteger(expectedShares) || expectedShares <= 0
    || !near(reference.cashAndEquivalents, amount("cashAndEquivalents"))
    || !near(reference.nonOperatingAssets, sum("nonOperatingAsset"))
    || !near(reference.interestBearingDebtExcludingLeases,
      amount("bankBorrowings") + amount("bondsCurrent") + amount("bondsNoncurrent"))
    || !near(reference.leaseLiabilities, amount("leaseCurrent") + amount("leaseNoncurrent"))
    || !near(reference.nciBookValue, amount("nciBookValue"))
    || !near(reference.otherClaims, sum("otherClaim"))
    || reference.issuedShares !== amount("issuedShares")
    || reference.treasuryShares !== amount("treasuryShares")
    || reference.ordinaryShares !== expectedShares) return false;
  const historicalRoles = ["profitBeforeTax", "netFinanceIncome", "associatesProfit",
    "jointVenturesProfit", "deemedDisposalGain"];
  if (historicalRoles.every((role) => byRole(role).length === 1)) {
    if (!record(preview.historicalOperatingProfitBasis)
      || !near(preview.historicalOperatingProfitBasis.value,
        amount("profitBeforeTax") - amount("netFinanceIncome") - amount("associatesProfit")
          - amount("jointVenturesProfit") - amount("deemedDisposalGain"))) return false;
  } else if (preview.historicalOperatingProfitBasis !== null) return false;
  const capexRoles = ["propertyPlantEquipmentPurchases", "intangibleAssetPurchases",
    "landLeasePrepayments"];
  if (capexRoles.every((role) => byRole(role).length === 1)) {
    if (!record(preview.historicalCashCapitalExpenditureBasis)
      || !near(preview.historicalCashCapitalExpenditureBasis.value,
        capexRoles.reduce((total, role) => total + amount(role), 0))) return false;
  } else if (preview.historicalCashCapitalExpenditureBasis !== null) return false;
  const wcRoles = ["currentAsset", "currentLiability", "priorAsset", "priorLiability"];
  const priorDate = (Number(String(selection.historicalAnnualPeriodEnd).slice(0, 4)) - 1) + "-12-31";
  for (const role of wcRoles) {
    const ids = wc[role] as string[];
    const selected = byRole(role);
    const metrics: readonly string[] = role.endsWith("Asset")
      ? FCFF_WORKING_CAPITAL_METRICS.asset : FCFF_WORKING_CAPITAL_METRICS.liability;
    const complete = ids.length > 0 && selected.length === ids.length
      && selected.every((fact) => ids.includes(String(fact.id))
        && metrics.includes(String(fact.metric))
        && monetary(fact, role.startsWith("prior") ? priorDate
          : String(selection.historicalAnnualPeriodEnd), false));
    if (!complete && !preview.workingCapitalMissing.includes(role)) return false;
  }
  if (preview.workingCapitalMissing.length === 0) {
    if (!record(preview.workingCapital)) return false;
    const priorNet = sum("priorAsset") - sum("priorLiability");
    const currentNet = sum("currentAsset") - sum("currentLiability");
    if (!near(preview.workingCapital.priorNet, priorNet)
      || !near(preview.workingCapital.currentNet, currentNet)
      || !near(preview.workingCapital.increase, currentNet - priorNet)) return false;
  } else if (preview.workingCapital !== null) return false;
  const reasons = ["cashReason", "nonOperatingAssetsReason", "debtReason",
    "leaseTreatmentReason", "noncontrollingInterestReason", "otherClaimsReason",
    "dilutedSharesReason", "balanceDateGapReason", "historicalBasisReason"];
  if (reasons.some((key) => typeof classification[key] !== "string"
    || String(classification[key]).trim().length < 8)) return false;
  return near(bridge.excessCash, Number(reference.cashAndEquivalents)
      + Number(classification.cashSinceReferenceAdjustment)
      - Number(classification.minimumOperatingCash))
    && near(bridge.nonOperatingAssets, Number(reference.nonOperatingAssets)
      + Number(classification.nonOperatingAssetAdjustment))
    && near(bridge.interestBearingDebt, Number(reference.interestBearingDebtExcludingLeases)
      + Number(classification.debtSinceReferenceAdjustment))
    && near(bridge.leaseLiabilitiesNotInDebt, Number(reference.leaseLiabilities)
      + Number(classification.leaseSinceReferenceAdjustment))
    && near(bridge.noncontrollingInterests, Number(reference.nciBookValue)
      + Number(classification.nciFairValueAdjustment))
    && near(bridge.otherNonordinaryClaims, Number(reference.otherClaims)
      + Number(classification.otherClaimsAdjustment))
    && bridge.dilutedOrdinaryShares === Number(reference.ordinaryShares)
      + Number(classification.ordinarySharesSinceReferenceAdjustment)
      + Number(classification.potentialDilutionShares);
}

function finiteFcffSourceFact(value: Record<string, unknown>): boolean {
  return validPositiveId(value.id) && validPositiveId(value.materialId)
    && Number.isSafeInteger(value.materialRevision) && Number(value.materialRevision) > 0
    && typeof value.metric === "string" && typeof value.periodEnd === "string"
    && typeof value.currency === "string" && typeof value.scope === "string"
    && typeof value.value === "number" && Number.isFinite(value.value)
    && typeof value.unitScale === "number" && Number.isFinite(value.unitScale) && value.unitScale > 0
    && typeof value.originalSha256 === "string" && /^[a-f0-9]{64}$/.test(value.originalSha256)
    && typeof value.citationSha256 === "string" && /^[a-f0-9]{64}$/.test(value.citationSha256)
    && (value.publishedAt === null || typeof value.publishedAt === "string"
      && fcffPublishedHongKongDay(value.publishedAt) !== null);
}

// eslint-disable-next-line complexity -- source identity, Owner inputs, calculation, and safety are validated together.
function validateProviderValuationScenarioSet(value:unknown,envelope:Record<string,unknown>,index:number,errors:string[]):void{
  const label=`providerScenarioSets[${index}]`;
  if(!record(value)){errors.push(`${label} must be an object`);return;}
  exact(value,["id","membershipId","membershipVersionAtWrite","symbol","revision","replacesScenarioSetId",
    "scenarioState","recomputable","invalidatedBy","basisKind","providerBasis","assumptions","calculation",
    "safety","createdAt"],label,errors);
  const invalidations=Array.isArray(value.invalidatedBy)?value.invalidatedBy:null;
  if(!validPositiveId(value.id)||value.membershipId!==envelope.membershipId||value.symbol!==envelope.symbol
    ||!Number.isSafeInteger(value.membershipVersionAtWrite)||Number(value.membershipVersionAtWrite)<1
    ||!Number.isSafeInteger(value.revision)||Number(value.revision)<1
    ||(value.replacesScenarioSetId!==null&&!validPositiveId(value.replacesScenarioSetId))
    ||(value.replacesScenarioSetId===null)!==(value.revision===1)
    ||!["current","replaced"].includes(String(value.scenarioState))
    ||typeof value.recomputable!=="boolean"||!invalidations
    ||typeof value.createdAt!=="string"||!isRfc3339DateTime(value.createdAt)
    ||value.basisKind!=="provider")errors.push(`${label} identity is invalid`);
  if(!record(value.providerBasis)){errors.push(`${label} source basis is missing`);return;}
  const basis=value.providerBasis;
  exact(basis,["kind","sourceClassification","membershipId","membershipVersion","symbol","sourceMaterialId",
    "sourceMaterialRevision","sourceMaterialFingerprint","eps","valuation","issuerOriginalVerification",
    "restatementComparability","publicationTime","currencyConversion"],`${label}.providerBasis`,errors);
  if(basis.kind!=="provider"||basis.sourceClassification!=="third_party_statement"
    ||basis.membershipId!==value.membershipId||basis.membershipVersion!==value.membershipVersionAtWrite
    ||basis.symbol!==value.symbol||!validPositiveId(basis.sourceMaterialId)
    ||!Number.isSafeInteger(basis.sourceMaterialRevision)||Number(basis.sourceMaterialRevision)<1
    ||!sha256(basis.sourceMaterialFingerprint)||basis.issuerOriginalVerification!=="UNKNOWN"
    ||basis.restatementComparability!=="UNKNOWN"||basis.publicationTime!=="UNKNOWN"
    ||basis.currencyConversion!=="NONE")errors.push(`${label} source identity is invalid`);
  if(!record(basis.eps)||!record(basis.valuation)){errors.push(`${label} EPS or PE source is missing`);return;}
  exact(basis.eps,["financialCaptureId","pageId","rawSha256","reportSha256","periodEnd","fiscalYear",
    "accountingStandards","capturedAt","currencyCode","basis","fieldId","rawValue"],`${label}.eps`,errors);
  exact(basis.valuation,["captureId","rawSha256","valuationType","intervalType","capturedAt",
    "providerUpdatedAt","currentValue","historicalAverage","historicalPercentile","historicalCount",
    "firstHistoricalDate","lastHistoricalDate"],`${label}.valuation`,errors);
  if(!validPositiveId(basis.eps.financialCaptureId)||!validPositiveId(basis.eps.pageId)
    ||![basis.eps.rawSha256,basis.eps.reportSha256,basis.valuation.rawSha256].every(sha256)
    ||typeof basis.eps.periodEnd!=="string"||!isoCalendarDate(basis.eps.periodEnd)||!Number.isSafeInteger(basis.eps.fiscalYear)
    ||basis.eps.periodEnd!==`${basis.eps.fiscalYear}-12-31`
    ||!(["basic","diluted"].includes(String(basis.eps.basis)))
    ||basis.eps.fieldId!==(basis.eps.basis==="basic"?5054:5055)
    ||typeof basis.eps.rawValue!=="string"||!/^\d+(?:\.\d{1,6})?$/.test(basis.eps.rawValue)
    ||Number(basis.eps.rawValue)<=0||typeof basis.eps.currencyCode!=="string"
    ||!isRfc3339DateTime(String(basis.eps.capturedAt))
    ||!validPositiveId(basis.valuation.captureId)||basis.valuation.valuationType!=="PE"
    ||basis.valuation.intervalType!=="YEAR_5"||!finite(basis.valuation.historicalAverage)
    ||Number(basis.valuation.historicalAverage)<=0||!Number.isSafeInteger(basis.valuation.historicalCount)
    ||Number(basis.valuation.historicalCount)<2)errors.push(`${label} saved original reference is invalid`);
  if(!record(value.assumptions)||value.assumptions.authority!=="owner"
    ||value.assumptions.derivation!=="provider_reference_owner_confirmed"
    ||!validateAnnualValuationScenarioInput(value.assumptions.values).ok
    ||!record(value.assumptions.values)
    ||value.assumptions.values.metricCurrency!==basis.eps.currencyCode
    ||value.assumptions.values.methodId!=="discounted_forward_metric_multiple_user_scenario")
    errors.push(`${label} Owner assumptions are invalid`);
  else validateCalculation(value.calculation,value.assumptions,index,errors);
  if(record(value.calculation)&&record(value.calculation.method)
    &&value.calculation.method.applicability!==undefined)
    errors.push(`${label} must not claim issuer-anchor applicability`);
  const expected:string[]=[];
  if(value.scenarioState==="replaced")expected.push("scenario_replaced");
  if(value.membershipVersionAtWrite!==envelope.membershipVersion)expected.push("membership_version_changed");
  if(envelope.membershipState==="archived")expected.push("membership_archived");
  if(invalidations&&(!invalidations.every((reason)=>[...expected,"provider_material_changed","provider_original_unavailable"].includes(reason))
    ||expected.some((reason,offset)=>invalidations[offset]!==reason)
    ||value.recomputable!==(invalidations.length===0)))errors.push(`${label} invalidation state is inconsistent`);
  if(!record(value.safety)||value.safety.advisoryOnly!==true||value.safety.forecast!==false
    ||value.safety.recommendation!==false||value.safety.automaticSignal!==false
    ||value.safety.createsOrder!==false||value.safety.callsBroker!==false
    ||value.safety.mutatesOfficialPortfolio!==false)errors.push(`${label} safety boundary is invalid`);
}

export function validateResearchValuationScenarioSet(
  value: unknown,
  envelope: Record<string, unknown>,
  index: number,
  errors: string[],
  historicalFrozen = false
): void {
  if (!record(value)) {
    errors.push(`scenarioSets[${index}] must be an object`);
    return;
  }
  const legacy = historicalFrozen && !Object.hasOwn(value, "anchorOriginalAvailability");
  exactOptional(value, [
    "id", "membershipId", "membershipVersionAtWrite", "symbol", "revision",
    "replacesScenarioSetId", "scenarioState", "recomputable", "invalidatedBy",
    "anchor", "anchorOriginalAvailability", "pairedAnchor", "assumptions", "calculation", "safety", "createdAt",
    "issuerBasisCurrentness"
  ], legacy ? ["pairedAnchor", "anchorOriginalAvailability", "issuerBasisCurrentness"]
    : ["pairedAnchor", "issuerBasisCurrentness"], `scenarioSets[${index}]`, errors);
  positiveId(value.id, `scenarioSets[${index}].id`, errors);
  if (value.membershipId !== envelope.membershipId || value.symbol !== envelope.symbol) {
    errors.push(`scenarioSets[${index}] identity is invalid`);
  }
  if (!Number.isSafeInteger(value.membershipVersionAtWrite) || Number(value.membershipVersionAtWrite) <= 0) {
    errors.push(`scenarioSets[${index}] membershipVersionAtWrite is invalid`);
  }
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) <= 0) errors.push(`scenarioSets[${index}] revision is invalid`);
  if (value.replacesScenarioSetId !== null) positiveId(value.replacesScenarioSetId, `scenarioSets[${index}].replacesScenarioSetId`, errors);
  if ((value.replacesScenarioSetId === null) !== (value.revision === 1)) errors.push(`scenarioSets[${index}] revision chain is invalid`);
  if (!["current", "replaced"].includes(String(value.scenarioState))) errors.push(`scenarioSets[${index}] state is invalid`);
  const invalidatedBy = Array.isArray(value.invalidatedBy) ? value.invalidatedBy : null;
  if (typeof value.recomputable !== "boolean" || invalidatedBy === null) errors.push(`scenarioSets[${index}] recomputation state is invalid`);
  if (value.recomputable === true && (value.scenarioState !== "current" || invalidatedBy?.length !== 0)) {
    errors.push(`scenarioSets[${index}] recomputable state is inconsistent`);
  }
  const expectedInvalidations = validateAnchor(value.anchor, envelope, value, index, errors, legacy);
  validateAnchorOriginalAvailability(value, index, errors, legacy);
  expectedInvalidations.push(...validateNavPair(value, envelope, index, errors, legacy));
  validateIssuerBasisCurrentness(value, index, expectedInvalidations, errors);
  if (invalidatedBy !== null
    && (invalidatedBy.length !== expectedInvalidations.length
      || invalidatedBy.some((reason, offset) => reason !== expectedInvalidations[offset]))) {
    errors.push(`scenarioSets[${index}] invalidation reasons are inconsistent`);
  }
  if (value.recomputable !== (expectedInvalidations.length === 0)) {
    errors.push(`scenarioSets[${index}] recomputable state does not match current anchor facts`);
  }
  if (!record(value.assumptions)
    || value.assumptions.authority !== "owner"
    || value.assumptions.derivation !== expectedIssuerDerivation(value.calculation)) {
    errors.push(`scenarioSets[${index}] assumptions authority is invalid`);
  } else {
    exact(value.assumptions, ["authority", "derivation", "values"], `scenarioSets[${index}].assumptions`, errors);
    const assumptions = validateAnnualValuationScenarioInput(value.assumptions.values);
    if (!assumptions.ok) errors.push(...assumptions.errors.map((error) => `scenarioSets[${index}].${error}`));
  }
  validateCalculation(value.calculation, value.assumptions, index, errors);
  if (record(value.safety)) exact(value.safety, ["advisoryOnly", "forecast", "recommendation", "automaticSignal", "createsOrder", "callsBroker", "mutatesOfficialPortfolio"], `scenarioSets[${index}].safety`, errors);
  if (!record(value.safety)
    || value.safety.advisoryOnly !== true
    || value.safety.forecast !== false
    || value.safety.recommendation !== false
    || value.safety.automaticSignal !== false
    || value.safety.createsOrder !== false
    || value.safety.callsBroker !== false
    || value.safety.mutatesOfficialPortfolio !== false) {
    errors.push(`scenarioSets[${index}] safety boundary is invalid`);
  }
  if (typeof value.createdAt !== "string" || !isRfc3339DateTime(value.createdAt)) errors.push(`scenarioSets[${index}] createdAt is invalid`);
}

function expectedIssuerDerivation(calculation: unknown): ResearchValuationScenarioSetData["assumptions"]["derivation"] {
  return record(calculation) && Object.hasOwn(calculation, "issuerBasis")
    ? "issuer_nav_source_draft_owner_confirmed" : "manual_not_derived_from_citation";
}

function validateAnchorOriginalAvailability(
  scenario: Record<string, unknown>, index: number, errors: string[], legacy = false
): void {
  if (legacy) return;
  if (!["available", "unavailable", "unknown"].includes(String(scenario.anchorOriginalAvailability))) {
    errors.push(`scenarioSets[${index}] anchor original availability is invalid`);
  }
  if (record(scenario.anchor) && record(scenario.anchor.source)
    && scenario.anchor.source.kind === "source_snapshot"
    && scenario.anchor.source.originalAvailability !== scenario.anchorOriginalAvailability) {
    errors.push(`scenarioSets[${index}] anchor original availability does not match its snapshot`);
  }
}

function validateIssuerBasisCurrentness(
  scenario: Record<string, unknown>, index: number,
  expected: ResearchValuationScenarioSetData["invalidatedBy"], errors: string[]
): void {
  const calculation = record(scenario.calculation) ? scenario.calculation : {};
  if (Object.hasOwn(calculation, "issuerBasis")) {
    const basis = calculation.issuerBasis;
    const assumptions = record(scenario.assumptions) && record(scenario.assumptions.values)
      ? scenario.assumptions.values : {};
    if (!validResearchValuationIssuerBasisBinding(basis)
      || !["available", "unavailable"].includes(String(scenario.issuerBasisCurrentness))) {
      errors.push(`scenarioSets[${index}] issuer basis binding is invalid`);
    } else if (basis.assetValueId !== (record(scenario.anchor) ? scenario.anchor.id : null)
      && basis.liabilityValueId !== (record(scenario.anchor) ? scenario.anchor.id : null)
      || assumptions.methodId !== "adjusted_net_asset_value_user_scenario"
      || assumptions.shareBasis !== "basic" || assumptions.netCashPerShare !== 0
      || basis.adoptionMode === "source_value"
        && assumptions.baseMetricPerShare !== basis.proposedBaseMetricPerShare) {
      errors.push(`scenarioSets[${index}] issuer basis assumptions are inconsistent`);
    }
    if (scenario.issuerBasisCurrentness !== "available") expected.push("issuer_basis_unavailable");
  } else if (Object.hasOwn(scenario, "issuerBasisCurrentness")) {
    errors.push(`scenarioSets[${index}] manual valuation must not claim an issuer basis`);
  }
}

function validateAnchor(
  value: unknown,
  envelope: Record<string, unknown>,
  scenario: Record<string, unknown>,
  index: number,
  errors: string[],
  legacy = false
): ResearchValuationScenarioSetData["invalidatedBy"] {
  if (!record(value)) {
    errors.push(`scenarioSets[${index}] anchor identity is invalid`);
    return [];
  }
  exact(value, [
    "id", "membershipId", "membershipVersionAtWrite", "symbol", "metric", "periodKind",
    "periodStart", "periodEnd", "currency", "unitScale", "scope", "valueStatus",
    "value", "comparability", "comparabilityReason", "amendmentKind", "replacesValueId",
    "revision", "valueState", "provenance", "source", "createdAt", "anchorRole"
  ], `scenarioSets[${index}].anchor`, errors);
  if (value.anchorRole !== (expectedIssuerDerivation(scenario.calculation) === "issuer_nav_source_draft_owner_confirmed"
    ? "issuer_nav_source_draft_input" : "cited_context_only_not_calculation_input")
    || value.membershipId !== envelope.membershipId
    || value.membershipVersionAtWrite !== scenario.membershipVersionAtWrite
    || value.symbol !== envelope.symbol
    || !["revenue", "profit_attributable_to_owners", "total_assets", "total_liabilities"].includes(String(value.metric))) {
    errors.push(`scenarioSets[${index}] anchor identity is invalid`);
  }
  positiveId(value.id, `scenarioSets[${index}].anchor.id`, errors);
  if (!Number.isSafeInteger(value.membershipVersionAtWrite) || Number(value.membershipVersionAtWrite) <= 0) {
    errors.push(`scenarioSets[${index}] anchor membershipVersionAtWrite is invalid`);
  }
  validateAnchorPeriodAndValue(value, index, errors);
  validateAnchorProvenance(value.provenance, index, errors);
  if (!record(value.source)) {
    errors.push(`scenarioSets[${index}] anchor source is invalid`);
    return [];
  }
  validateAnchorSource(value.source,index,errors);
  validateAnchorState(value, value.source, envelope, index, errors);
  return anchorInvalidations(value, value.source, envelope, scenario, legacy);
}

function validateNavPair(
  scenario: Record<string, unknown>,
  envelope: Record<string, unknown>,
  index: number,
  errors: string[],
  legacy = false
): ResearchValuationScenarioSetData["invalidatedBy"] {
  const calculation = record(scenario.calculation) ? scenario.calculation : {};
  const method = record(calculation.method) ? calculation.method : {};
  const applicability = record(method.applicability) ? method.applicability : {};
  const pairedId = applicability.pairedAnchorValueId;
  if (method.id !== "adjusted_net_asset_value_user_scenario") {
    if (scenario.pairedAnchor != null || pairedId !== undefined) errors.push(`scenarioSets[${index}] non-NAV pair is invalid`);
    return [];
  }
  if (pairedId === undefined) {
    return unboundNavPair(scenario, index, errors, legacy);
  }
  if (!validPositiveId(pairedId) || !record(scenario.pairedAnchor)) return ["nav_pair_unavailable"];
  const paired = scenario.pairedAnchor;
  validateAnchor(paired, envelope, {
    ...scenario, membershipVersionAtWrite: paired.membershipVersionAtWrite
  }, index, errors);
  const anchor = record(scenario.anchor) ? scenario.anchor : {};
  const pairMatches = paired.id === pairedId && paired.id !== anchor.id
    && ((anchor.metric === "total_assets" && paired.metric === "total_liabilities")
      || (anchor.metric === "total_liabilities" && paired.metric === "total_assets"))
    && paired.membershipId === anchor.membershipId && paired.symbol === anchor.symbol
    && paired.membershipVersionAtWrite === scenario.membershipVersionAtWrite
    && anchor.periodKind === "instant" && paired.periodKind === "instant"
    && anchor.periodStart === null && paired.periodStart === null
    && paired.periodEnd === anchor.periodEnd && paired.currency === anchor.currency
    && paired.unitScale === anchor.unitScale && paired.scope === anchor.scope
    && paired.valueState === "current" && paired.valueStatus === "reported" && paired.value !== null
    && paired.comparability === "comparable" && paired.comparabilityReason === null
    && record(paired.source) && paired.source.materialRevisionState === "current"
    && paired.source.freshness === "fresh"
    && (paired.source.kind !== "source_snapshot"
      || paired.source.snapshotReviewState === "current" && paired.source.originalAvailability === "available");
  return pairMatches ? [] : ["nav_pair_unavailable"];
}

function unboundNavPair(
  scenario: Record<string, unknown>, index: number, errors: string[], legacy: boolean
): ResearchValuationScenarioSetData["invalidatedBy"] {
  if (scenario.pairedAnchor != null) errors.push(`scenarioSets[${index}] unbound NAV pair must not claim a companion`);
  return legacy ? [] : ["nav_pair_unbound"];
}

function validateAnchorSource(source:Record<string,unknown>,index:number,errors:string[]):void {
  const label=`scenarioSets[${index}].anchor.source`;
  const common=["materialId","materialRevision","materialRevisionState","validUntil","freshness","materialSourceVersion"];
  const optional=["sourceClassification","verificationStatus","publishedAt"].filter(key=>Object.hasOwn(source,key));
  positiveId(source.materialId,`${label}.materialId`,errors);
  if(!Number.isSafeInteger(source.materialRevision)||Number(source.materialRevision)<1
    ||typeof source.materialSourceVersion!=="string"||!source.materialSourceVersion.trim()
    ||source.materialSourceVersion.length>200)errors.push(`${label} material identity is invalid`);
  if(source.kind==="source_snapshot"){
    exact(source,[...common,"kind","snapshotCitation","snapshotOriginal","snapshotReviewState","originalAvailability",...optional],label,errors);
    const citation=source.snapshotCitation,original=source.snapshotOriginal;
    if(!record(citation)||!record(original)) {errors.push(`${label} snapshot citation is invalid`);return;}
    exact(citation,["kind","snapshotId","textSha256","startUtf16","endUtf16","excerptSha256"],`${label}.snapshotCitation`,errors);
    exact(original,["rawSha256","byteLength","mediaType","canonicalUrl","responseUrl"],`${label}.snapshotOriginal`,errors);
    if(!["current","pending_review"].includes(String(source.snapshotReviewState))
      ||!["available","unavailable","unknown"].includes(String(source.originalAvailability))
      ||citation.kind!=="source_snapshot"||!validPositiveId(citation.snapshotId)
      ||![citation.textSha256,citation.excerptSha256,original.rawSha256].every(sha256)
      ||!Number.isSafeInteger(citation.startUtf16)||Number(citation.startUtf16)<0
      ||!Number.isSafeInteger(citation.endUtf16)||Number(citation.endUtf16)<=Number(citation.startUtf16)
      ||!Number.isSafeInteger(original.byteLength)||Number(original.byteLength)<1
      ||original.mediaType!=="text/html"||typeof original.canonicalUrl!=="string"
      ||typeof original.responseUrl!=="string"||!original.canonicalUrl.startsWith("https://")
      ||!original.responseUrl.startsWith("https://"))errors.push(`${label} snapshot identity is invalid`);
    return;
  }
  exact(source,[...common,"documentId","documentPdfSha256","pageNumber","pageTextSha256",...optional],label,errors);
  positiveId(source.documentId,`${label}.documentId`,errors);
  if(!Number.isSafeInteger(source.pageNumber)||Number(source.pageNumber)<1
    ||!sha256(source.pageTextSha256)||!sha256(source.documentPdfSha256))errors.push(`${label} PDF identity is invalid`);
}

function validPositiveId(value:unknown):boolean{return typeof value==="string"&&/^[1-9]\d*$/.test(value);}
function sha256(value:unknown):boolean{return typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);}

function validateAnchorState(
  value: Record<string, unknown>,
  source: Record<string, unknown>,
  envelope: Record<string, unknown>,
  index: number,
  errors: string[]
): void {
  if (!["current", "replaced", "historical_source_superseded", "historical_source_stale"].includes(String(value.valueState))
    || !["reported", "explicit_unknown"].includes(String(value.valueStatus))
    || !["comparable", "not_comparable"].includes(String(value.comparability))
    || !["current", "superseded"].includes(String(source.materialRevisionState))
    || !["fresh", "stale"].includes(String(source.freshness))
    || typeof source.validUntil !== "string"
    || !isRfc3339DateTime(source.validUntil)) {
    errors.push(`scenarioSets[${index}] anchor state is invalid`);
    return;
  }
  const validUntil = Date.parse(source.validUntil);
  const generatedAt = typeof envelope.generatedAt === "string" ? Date.parse(envelope.generatedAt) : Number.NaN;
  if (!Number.isFinite(validUntil) || !Number.isFinite(generatedAt)
    || (source.freshness === "fresh") !== (validUntil > generatedAt)) {
    errors.push(`scenarioSets[${index}] anchor freshness boundary is invalid`);
  }
  if (value.valueState === "current"
    && (source.materialRevisionState !== "current" || source.freshness !== "fresh"
      || source.kind === "source_snapshot" && source.snapshotReviewState !== "current")) {
    errors.push(`scenarioSets[${index}] current anchor requires a current fresh source`);
  }
  if (value.valueState === "historical_source_superseded" && source.materialRevisionState !== "superseded"
    && !(source.kind === "source_snapshot" && source.snapshotReviewState === "pending_review")) {
    errors.push(`scenarioSets[${index}] superseded anchor state is inconsistent`);
  }
  if (value.valueState === "historical_source_stale"
    && (source.materialRevisionState !== "current" || source.freshness !== "stale")) {
    errors.push(`scenarioSets[${index}] stale anchor state is inconsistent`);
  }
}

function anchorInvalidations(
  value: Record<string, unknown>,
  source: Record<string, unknown>,
  envelope: Record<string, unknown>,
  scenario: Record<string, unknown>,
  legacy = false
): ResearchValuationScenarioSetData["invalidatedBy"] {
  const invalidations: ResearchValuationScenarioSetData["invalidatedBy"] = [];
  if (scenario.scenarioState === "replaced") invalidations.push("scenario_replaced");
  if (scenario.membershipVersionAtWrite !== envelope.membershipVersion) invalidations.push("membership_version_changed");
  if (envelope.membershipState === "archived") invalidations.push("membership_archived");
  if (value.valueState === "replaced") invalidations.push("anchor_replaced");
  if (source.materialRevisionState === "superseded") invalidations.push("anchor_source_superseded");
  if (source.kind === "source_snapshot" && source.snapshotReviewState === "pending_review")
    invalidations.push("anchor_source_review_required");
  if (legacy ? source.kind === "source_snapshot" && source.originalAvailability !== "available"
    : scenario.anchorOriginalAvailability !== "available")
    invalidations.push("anchor_source_original_unavailable");
  if (value.valueState === "historical_source_stale"
    || source.freshness === "stale") invalidations.push("anchor_source_stale");
  if (value.valueStatus !== "reported" || value.value === null) invalidations.push("anchor_not_reported");
  if (value.comparability !== "comparable" || value.comparabilityReason !== null) invalidations.push("anchor_not_comparable");
  if (!["revenue", "profit_attributable_to_owners", "total_assets", "total_liabilities"].includes(String(value.metric))) invalidations.push("anchor_metric_ineligible");
  const methodId = record(scenario.assumptions) && record(scenario.assumptions.values)
    ? annualValuationMethodId(scenario.assumptions.values as unknown as AnnualValuationScenarioInput)
    : "discounted_forward_metric_multiple_user_scenario";
  const applicable = methodId === "adjusted_net_asset_value_user_scenario"
    ? ["total_assets", "total_liabilities"]
    : ["revenue", "profit_attributable_to_owners"];
  if (!applicable.includes(String(value.metric))) invalidations.push("method_anchor_inapplicable");
  return [...new Set(invalidations)];
}

function validateAnchorPeriodAndValue(
  value: Record<string, unknown>,
  index: number,
  errors: string[]
): void {
  if (!["duration", "instant"].includes(String(value.periodKind))
    || typeof value.periodEnd !== "string"
    || !isoCalendarDate(value.periodEnd)
    || (value.periodKind === "duration"
      ? typeof value.periodStart !== "string"
        || !isoCalendarDate(value.periodStart)
        || value.periodStart >= value.periodEnd
      : value.periodStart !== null)
    || typeof value.currency !== "string"
    || !/^[A-Z]{3}$/.test(value.currency)
    || !Number.isSafeInteger(value.unitScale)
    || ![1, 1_000, 1_000_000, 1_000_000_000].includes(Number(value.unitScale))
    || !["consolidated", "parent_company"].includes(String(value.scope))
    || !["reported", "explicit_unknown"].includes(String(value.valueStatus))
    || (value.valueStatus === "reported"
      ? typeof value.value !== "string" || !/^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value.value) || value.value === "-0"
      : value.value !== null)
    || !["comparable", "not_comparable"].includes(String(value.comparability))
    || (value.comparability === "comparable"
      ? value.comparabilityReason !== null
      : typeof value.comparabilityReason !== "string"
        || value.comparabilityReason.trim().length === 0
        || value.comparabilityReason.length > 500)
    || !["initial", "restatement", "correction"].includes(String(value.amendmentKind))
    || (value.replacesValueId !== null && (typeof value.replacesValueId !== "string" || !/^[1-9]\d*$/.test(value.replacesValueId)))
    || !Number.isSafeInteger(value.revision)
    || Number(value.revision) <= 0
    || (value.amendmentKind === "initial"
      ? value.replacesValueId !== null || value.revision !== 1
      : value.replacesValueId === null || Number(value.revision) <= 1)
    || typeof value.createdAt !== "string"
    || !isRfc3339DateTime(value.createdAt)) {
    errors.push(`scenarioSets[${index}] anchor fact structure is invalid`);
  }
}

function validateAnchorProvenance(value: unknown, index: number, errors: string[]): void {
  if (!record(value)) {
    errors.push(`scenarioSets[${index}] anchor provenance is invalid`);
    return;
  }
  exact(value, ["factKind", "transcription", "verificationStatus"], `scenarioSets[${index}].anchor.provenance`, errors);
  if (value.factKind !== "issuer_reported"
    || value.transcription !== "owner_manual"
    || !["unverified", "verified", "owner_confirmed", "source_text_verified"].includes(String(value.verificationStatus))) {
    errors.push(`scenarioSets[${index}] anchor provenance is invalid`);
  }
}

// eslint-disable-next-line complexity -- one closed wire-contract validator; keep checks co-located.
function validateCalculation(
  value: unknown,
  assumptions: unknown,
  index: number,
  errors: string[]
): void {
  const input = record(assumptions) ? validateAnnualValuationScenarioInput(assumptions.values) : null;
  const methodId = input?.ok ? annualValuationMethodId(input.value) : "discounted_forward_metric_multiple_user_scenario";
  const adjusted = methodId === "adjusted_net_asset_value_user_scenario";
  if (!record(value) || !record(value.method)
    || value.method.id !== methodId
    || value.method.calculationVersion !== (adjusted ? ANNUAL_ADJUSTED_NET_ASSET_CALCULATION_VERSION : ANNUAL_VALUATION_CALCULATION_VERSION)
    || value.method.presentValueFormula !== (adjusted ? ANNUAL_ADJUSTED_NET_ASSET_VALUE_FORMULA : ANNUAL_VALUATION_PRESENT_VALUE_FORMULA)
    || value.method.rounding !== "decimal_places_6"
    || !finite(value.projectedMetricPerShare)
    || !finite(value.scenarioPresentValuePerShare)
    || !Array.isArray(value.diagonal)
    || value.diagonal.length !== 3
    || !record(value.matrix)
    || !Array.isArray(value.matrix.growthRates)
    || value.matrix.growthRates.length !== 3
    || !Array.isArray(value.matrix.terminalMultiples)
    || value.matrix.terminalMultiples.length !== 3
    || !Array.isArray(value.matrix.cells)
    || value.matrix.cells.length !== 9) {
    errors.push(`scenarioSets[${index}] calculation is invalid`);
    return;
  }
  exactOptional(value, ["method", "projectedMetricPerShare", "scenarioPresentValuePerShare", "diagonal", "matrix", "valueRange", "issuerBasis"], ["valueRange", "issuerBasis"], `scenarioSets[${index}].calculation`, errors);
  if (Object.hasOwn(value, "issuerBasis") && (!adjusted || !validResearchValuationIssuerBasisBinding(value.issuerBasis))) {
    errors.push(`scenarioSets[${index}] issuer basis calculation is invalid`);
  }
  exactOptional(value.method, ["id", "calculationVersion", "presentValueFormula", "rounding", "applicability"], ["applicability"], `scenarioSets[${index}].calculation.method`, errors);
  exact(value.matrix, ["growthRates", "terminalMultiples", "cells"], `scenarioSets[${index}].calculation.matrix`, errors);
  value.diagonal.forEach((item, offset) => { if (record(item)) exact(item, ["scenario", "annualGrowthRate", "terminalMultiple", "presentValuePerShare"], `scenarioSets[${index}].calculation.diagonal[${offset}]`, errors); });
  value.matrix.cells.forEach((item, offset) => { if (record(item)) exact(item, ["annualGrowthRate", "terminalMultiple", "presentValuePerShare"], `scenarioSets[${index}].calculation.matrix.cells[${offset}]`, errors); });
  if (!input?.ok) return;
  if (value.method.applicability !== undefined) validateCalculationApplicability(value.method.applicability, adjusted, index, errors);
  const expected = calculateAnnualValuationScenarioGrid(input.value);
  if (!expected
    || value.projectedMetricPerShare !== expected.projectedMetricPerShare
    || value.scenarioPresentValuePerShare !== expected.scenarioPresentValuePerShare
    || !sameNumbers(value.matrix.growthRates, expected.growthRates)
    || !sameNumbers(value.matrix.terminalMultiples, expected.terminalMultiples)
    || value.matrix.cells.some((cell, offset) => {
      const expectedCell = expected.cells[offset];
      return !record(cell) || !expectedCell
        || cell.annualGrowthRate !== expectedCell.annualGrowthRate
        || cell.terminalMultiple !== expectedCell.terminalMultiple
        || cell.presentValuePerShare !== expectedCell.presentValuePerShare;
    })) {
    errors.push(`scenarioSets[${index}] calculation does not recompute from the exact Owner assumptions`);
  }
  const diagonalIndexes = [0, 4, 8];
  const labels = ["bear", "base", "bull"];
  for (let offset = 0; offset < diagonalIndexes.length; offset += 1) {
    const diagonal = value.diagonal[offset];
    const cell = value.matrix.cells[diagonalIndexes[offset]];
    if (!record(diagonal) || !record(cell)
      || diagonal.scenario !== labels[offset]
      || diagonal.annualGrowthRate !== cell.annualGrowthRate
      || diagonal.terminalMultiple !== cell.terminalMultiple
      || diagonal.presentValuePerShare !== cell.presentValuePerShare) {
      errors.push(`scenarioSets[${index}] diagonal must be the 3x3 bear/base/bull diagonal`);
    }
  }
  if (value.valueRange !== undefined) {
    const values = diagonalIndexes.map((offset) => expected?.cells[offset]?.presentValuePerShare ?? Number.NaN);
    if (!record(value.valueRange)
      || value.valueRange.low !== Math.min(...values)
      || value.valueRange.high !== Math.max(...values)
      || value.valueRange.interpretation !== "research_scenario_range_not_target_price") {
      errors.push(`scenarioSets[${index}] value range must bind the bear base bull scenarios`);
    }
  }
}

function validateCalculationApplicability(value: unknown, adjusted: boolean, index: number, errors: string[]): void {
  if (!record(value)) {
    errors.push(`scenarioSets[${index}] method applicability is invalid`);
    return;
  }
  exactOptional(value, ["ownerConfirmed", "companyDataBasis", "requiredAnchorMetrics", "limitation", "pairedAnchorValueId"], ["pairedAnchorValueId"], `scenarioSets[${index}].method.applicability`, errors);
  const expectedBasis = adjusted ? "reported_balance_sheet_net_assets_per_share" : "forward_operating_metric_per_share";
  const expectedMetrics = adjusted ? ["total_assets", "total_liabilities"] : ["revenue", "profit_attributable_to_owners"];
  if (value.ownerConfirmed !== true || value.companyDataBasis !== expectedBasis
    || !Array.isArray(value.requiredAnchorMetrics)
    || value.requiredAnchorMetrics.join("|") !== expectedMetrics.join("|")
    || typeof value.limitation !== "string" || value.limitation.trim().length === 0) {
    errors.push(`scenarioSets[${index}] method applicability does not match the selected company-data basis`);
  }
  if (value.pairedAnchorValueId !== undefined && (!adjusted || !validPositiveId(value.pairedAnchorValueId))) {
    errors.push(`scenarioSets[${index}] NAV pair identity is invalid`);
  }
}

function sameNumbers(value: unknown, expected: number[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((item, index) => item === expected[index]);
}

function isoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: string[], label: string, errors: string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    errors.push(`${label} fields are invalid`);
  }
}

function exactOptional(value: Record<string, unknown>, keys: string[], optional: string[], label: string, errors: string[]): void {
  const actual = Object.keys(value).sort();
  const allowed = [...keys].sort();
  if (actual.some((key) => !allowed.includes(key))
    || keys.some((key) => !optional.includes(key) && !actual.includes(key))) {
    errors.push(`${label} fields are invalid`);
  }
}

function positiveId(value: unknown, key: string, errors: string[]): void {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) errors.push(`${key} must be a positive integer string`);
}

function bounded(value: unknown, key: string, max: number, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    errors.push(`${key} must be a non-empty string of at most ${max} characters`);
  }
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function invalid(errors: string[]): { ok: false; errors: string[] } {
  return { ok: false, errors };
}
