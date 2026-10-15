import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { ResearchFundamentalValueData, ResearchFundamentalsEnvelope }
  from "../../../../packages/contracts/src/researchFundamentals.js";
import { researchFundamentalCurrentlyUsable }
  from "../../../../packages/contracts/src/researchFundamentals.js";
import {
  FCFF_HISTORICAL_METRICS, FCFF_BRIDGE_METRICS, FCFF_NONOPERATING_METRICS,
  FCFF_OTHER_CLAIM_METRICS, FCFF_WORKING_CAPITAL_METRICS, fcffSourceSelectionErrors,
  fcffPublishedHongKongDay,
  type FcffHistoricalRole, type FcffBridgeRole, type FcffWorkingCapitalRole,
  type FcffSourceFactRole, type FcffSourceSelection, type FcffSourceFact,
  type FcffSourcePreview, type FcffScenarioInput, type FcffBridgeClassification
} from "../../../../packages/contracts/src/researchValuationFcff.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import { readResearchFundamentals } from "./researchFundamentalRepository.js";
import { issuerFactOriginalAvailable } from "./researchValuationIssuerBasis.js";
import type { SourceSnapshotStoreOptions } from "./researchSourceSnapshotRepository.js";

type Reader = Pick<Pool | PoolClient, "query">;
const historicalRoles = Object.keys(FCFF_HISTORICAL_METRICS) as FcffHistoricalRole[];
const bridgeRoles = Object.keys(FCFF_BRIDGE_METRICS) as FcffBridgeRole[];
const wcRoles: FcffWorkingCapitalRole[] = [
  "currentAsset", "currentLiability", "priorAsset", "priorLiability"
];
const shareRoles = new Set<FcffBridgeRole>(["issuedShares", "treasuryShares"]);
const signedHistorical = new Set<FcffHistoricalRole>([
  "profitBeforeTax", "netFinanceIncome", "associatesProfit",
  "jointVenturesProfit", "deemedDisposalGain"
]);

export async function readFcffSourcePreview(client: Reader, membershipId: string,
  selection: FcffSourceSelection, actor: AuthenticatedResearchActor, now = new Date(),
  store?: SourceSnapshotStoreOptions): Promise<FcffSourcePreview> {
  const fundamentals = await readResearchFundamentals(client, membershipId, actor, now, undefined, store);
  return deriveFcffSourcePreview(fundamentals, selection, now,
    (fact) => issuerFactOriginalAvailable(client, membershipId, fact, store));
}

export async function deriveFcffSourcePreview(fundamentals: ResearchFundamentalsEnvelope,
  selection: FcffSourceSelection, now: Date,
  originalAvailable: (fact: ResearchFundamentalValueData) => Promise<boolean>): Promise<FcffSourcePreview> {
  if (fcffSourceSelectionErrors(selection).length) throw new Error("FCFF_SOURCE_SELECTION_INVALID");
  const currency = fundamentals.values.find((value) =>
    value.id === selection.bridgeValueIds.cashAndEquivalents)?.currency ?? null;
  const facts: FcffSourceFact[] = [];
  const historicalMissingRoles: FcffHistoricalRole[] = [];
  const missingBridgeRoles: FcffSourcePreview["missingBridgeRoles"] = [];
  const workingCapitalMissing: FcffWorkingCapitalRole[] = [];
  const find = (id: string | null) => fundamentals.values.find((value) => value.id === id);
  const append = (value: ResearchFundamentalValueData, role: FcffSourceFactRole) => {
    facts.push({
      role, id: value.id, metric: value.metric, value: Number(value.value) * value.unitScale,
      periodStart: value.periodStart, periodEnd: value.periodEnd, currency: value.currency,
      unitScale: value.unitScale, scope: value.scope, materialId: value.source.materialId,
      materialRevision: value.source.materialRevision,
      publishedAt: fcffPublishedHongKongDay(value.source.publishedAt)
        ? value.source.publishedAt! : null,
      originalSha256: value.source.kind === "source_snapshot"
        ? value.source.snapshotOriginal.rawSha256 : value.source.documentPdfSha256,
      citationSha256: value.source.kind === "source_snapshot"
        ? value.source.snapshotCitation.textSha256 : value.source.pageTextSha256
    });
  };
  const eligible = async (value: ResearchFundamentalValueData | undefined,
    metric: string, date: string, flow: boolean, shares: boolean, signed = false) =>
    value !== undefined && sourceFactEligible(value, metric, date,
      fundamentals.membershipVersion, fundamentals.symbol, currency, now, flow, shares, signed)
    && await originalAvailable(value);
  for (const role of historicalRoles) {
    const value = find(selection.historicalValueIds[role]);
    if (!await eligible(value, FCFF_HISTORICAL_METRICS[role],
      selection.historicalAnnualPeriodEnd, true, false, signedHistorical.has(role)))
      historicalMissingRoles.push(role);
    else append(value!, role);
  }
  const priorDate = (Number(selection.historicalAnnualPeriodEnd.slice(0, 4)) - 1) + "-12-31";
  for (const role of wcRoles) {
    const ids = selection.workingCapitalValueIds[role];
    const date = role.startsWith("prior") ? priorDate : selection.historicalAnnualPeriodEnd;
    const metrics: readonly string[] = role.endsWith("Asset")
      ? FCFF_WORKING_CAPITAL_METRICS.asset : FCFF_WORKING_CAPITAL_METRICS.liability;
    const selected = ids.map(find);
    if (selected.length === 0 || new Set(selected.map((value) => value?.metric)).size !== selected.length
      || !(await Promise.all(selected.map((value) => value && metrics.includes(value.metric)
        ? eligible(value, value.metric, date, false, false) : false))).every(Boolean)) {
      workingCapitalMissing.push(role);
      continue;
    }
    selected.forEach((value) => append(value!, role));
  }
  for (const role of bridgeRoles) {
    const value = find(selection.bridgeValueIds[role]);
    if (!await eligible(value, FCFF_BRIDGE_METRICS[role],
      selection.balanceReferenceDate, false, shareRoles.has(role)))
      missingBridgeRoles.push(role);
    else append(value!, role);
  }
  for (const [role, ids, metrics] of [
    ["nonOperatingAsset", selection.nonOperatingAssetValueIds, FCFF_NONOPERATING_METRICS],
    ["otherClaim", selection.otherClaimValueIds, FCFF_OTHER_CLAIM_METRICS]
  ] as const) {
    const selected = ids.map(find);
    if (selected.length === 0 || new Set(selected.map((value) => value?.metric)).size !== selected.length
      || !(await Promise.all(selected.map((value) => value && (metrics as readonly string[]).includes(value.metric)
        ? eligible(value, value.metric, selection.balanceReferenceDate, false, false) : false))).every(Boolean)) {
      missingBridgeRoles.push(role);
      continue;
    }
    selected.forEach((value) => append(value!, role));
  }
  const amount = (role: FcffSourceFactRole) => facts.find((fact) => fact.role === role)?.value ?? NaN;
  const sum = (role: FcffSourceFactRole) => facts.filter((fact) => fact.role === role)
    .reduce((total, fact) => total + fact.value, 0);
  const historicalOperatingProfitBasis = historicalMissingRoles.some((role) =>
    signedHistorical.has(role)) ? null : {
    value: amount("profitBeforeTax") - amount("netFinanceIncome")
      - amount("associatesProfit") - amount("jointVenturesProfit") - amount("deemedDisposalGain"),
    formula: "profit before tax - net finance income - associates profit - joint ventures profit - deemed disposal gain" as const,
    limitation: "reported line combination, not normalized recurring EBIT" as const
  };
  const historicalCashCapitalExpenditureBasis = historicalMissingRoles.some((role) =>
    ["propertyPlantEquipmentPurchases", "intangibleAssetPurchases", "landLeasePrepayments"].includes(role))
    ? null : {
      value: amount("propertyPlantEquipmentPurchases") + amount("intangibleAssetPurchases")
        + amount("landLeasePrepayments"),
      formula: "property plant and equipment purchases + intangible asset purchases + land lease prepayments" as const,
      limitation: "cash outflow components, not complete capital reinvestment" as const
    };
  const priorNet = sum("priorAsset") - sum("priorLiability");
  const currentNet = sum("currentAsset") - sum("currentLiability");
  const workingCapital = workingCapitalMissing.length ? null : {
    priorNet, currentNet, increase: currentNet - priorNet,
    formula: "(current operating noncash assets - current operating nondebt liabilities) - (prior operating noncash assets - prior operating nondebt liabilities)" as const
  };
  const bridgeReference = missingBridgeRoles.length ? null : {
    cashAndEquivalents: amount("cashAndEquivalents"),
    nonOperatingAssets: sum("nonOperatingAsset"),
    interestBearingDebtExcludingLeases: amount("bankBorrowings")
      + amount("bondsCurrent") + amount("bondsNoncurrent"),
    leaseLiabilities: amount("leaseCurrent") + amount("leaseNoncurrent"),
    nciBookValue: amount("nciBookValue"),
    otherClaims: sum("otherClaim"),
    issuedShares: amount("issuedShares"), treasuryShares: amount("treasuryShares"),
    ordinaryShares: amount("issuedShares") - amount("treasuryShares")
  };
  if (bridgeReference && (!Number.isSafeInteger(bridgeReference.ordinaryShares)
    || bridgeReference.ordinaryShares <= 0)) {
    bridgeReference.ordinaryShares = NaN;
    missingBridgeRoles.push("issuedShares");
  }
  const complete = missingBridgeRoles.length === 0 && bridgeReference !== null && currency !== null
    && new Set(facts.map((fact) => fact.id)).size === facts.length;
  const sourceFingerprint = complete ? createHash("sha256").update(JSON.stringify({
    membershipId: fundamentals.membershipId, membershipVersion: fundamentals.membershipVersion,
    symbol: fundamentals.symbol, selection, facts, historicalOperatingProfitBasis,
    historicalCashCapitalExpenditureBasis, workingCapital, bridgeReference
  })).digest("hex") : null;
  return {
    status: complete ? "available" : "missing_inputs",
    membershipId: fundamentals.membershipId, membershipVersion: fundamentals.membershipVersion,
    symbol: fundamentals.symbol, currency,
    historicalAnnualPeriodEnd: selection.historicalAnnualPeriodEnd,
    balanceReferenceDate: selection.balanceReferenceDate, sourceFingerprint, facts,
    historicalMissingRoles, missingBridgeRoles, historicalOperatingProfitBasis,
    historicalCashCapitalExpenditureBasis, workingCapital, workingCapitalMissing,
    bridgeReference: complete ? bridgeReference : null
  };
}

export function fcffAssumptionsMatchSources(assumptions: FcffScenarioInput,
  classification: FcffBridgeClassification, preview: FcffSourcePreview): boolean {
  const reference = preview.bridgeReference;
  if (preview.status !== "available" || !reference || !preview.sourceFingerprint
    || assumptions.currency !== preview.currency
    || assumptions.historicalAnnualPeriodEnd !== preview.historicalAnnualPeriodEnd
    || assumptions.balanceReferenceDate !== preview.balanceReferenceDate
    || assumptions.valuationCutoff < preview.balanceReferenceDate
    || !preview.facts.every((fact) => {
      const publishedDay = fcffPublishedHongKongDay(fact.publishedAt);
      return publishedDay !== null && publishedDay <= assumptions.valuationCutoff;
    })) return false;
  const bridge = assumptions.bridge;
  const near = (actual: number, expected: number) =>
    Number.isFinite(expected) && Math.abs(actual - expected) <= 0.000001;
  return near(bridge.excessCash, reference.cashAndEquivalents
      + classification.cashSinceReferenceAdjustment - classification.minimumOperatingCash)
    && near(bridge.nonOperatingAssets,
      reference.nonOperatingAssets + classification.nonOperatingAssetAdjustment)
    && near(bridge.interestBearingDebt,
      reference.interestBearingDebtExcludingLeases + classification.debtSinceReferenceAdjustment)
    && near(bridge.leaseLiabilitiesNotInDebt,
      reference.leaseLiabilities + classification.leaseSinceReferenceAdjustment)
    && near(bridge.noncontrollingInterests,
      reference.nciBookValue + classification.nciFairValueAdjustment)
    && near(bridge.otherNonordinaryClaims,
      reference.otherClaims + classification.otherClaimsAdjustment)
    && bridge.dilutedOrdinaryShares === reference.ordinaryShares
      + classification.ordinarySharesSinceReferenceAdjustment
      + classification.potentialDilutionShares;
}

function sourceFactEligible(value: ResearchFundamentalValueData, metric: string,
  date: string, version: number, symbol: string, currency: string | null, now: Date,
  flow: boolean, shares: boolean, signed: boolean): boolean {
  const amount = Number(value.value) * value.unitScale;
  const source = value.source;
  return value.metric === metric && value.membershipVersionAtWrite === version
    && value.symbol === symbol && researchFundamentalCurrentlyUsable(value)
    && value.valueStatus === "reported" && value.value !== null && Number.isFinite(amount)
    && (signed || amount >= 0)
    && (!shares || Number.isSafeInteger(amount))
    && value.comparability === "comparable" && value.comparabilityReason === null
    && value.periodEnd === date
    && (flow ? value.periodKind === "duration" && value.periodStart === date.slice(0, 4) + "-01-01"
      : value.periodKind === "instant" && value.periodStart === null)
    && value.scope === (shares ? "parent_company" : "consolidated")
    && value.currency === (shares ? "XXX" : currency)
    && value.assertion?.unit === (shares ? "shares" : "currency")
    && value.assertion.measurementBasis === (shares ? "issued_shares" : "financial_statement")
    && value.assertion.category === "actual" && value.assertion.sourceChecked === true
    && source.materialRevisionState === "current" && source.freshness === "fresh"
    && source.sourceClassification === "issuer_statement" && source.verificationStatus === "unverified"
    && Date.parse(source.validUntil) > now.getTime()
    && value.provenance.factKind === "issuer_reported"
    && ["verified", "owner_confirmed", "source_text_verified"].includes(value.provenance.verificationStatus);
}
