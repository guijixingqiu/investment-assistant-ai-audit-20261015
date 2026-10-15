import type { ResearchFinancialCoverage, ResearchFinancialPeriodCoverage, ResearchFundamentalValueData } from "./researchFundamentals.js";

type Value = ResearchFundamentalValueData;
type Basis = { key: string; values: Value[] };
const metrics = ["revenue","profit_attributable_to_owners","operating_cash_flow","total_assets","total_liabilities"] as const;
const RESEARCH_FINANCIAL_REQUIRED_ANNUAL_PERIODS=5;
const durationMetrics = new Set<string>(["revenue", "profit_attributable_to_owners", "operating_cash_flow"]);

function qualifies(value: Value): boolean {
  const assertion = value.assertion;
  return value.valueState === "current"
    && (value.source.kind !== "source_snapshot" || (value.source.snapshotReviewState === "current"
      && value.source.originalAvailability === "available"))
    && value.source.freshness === "fresh"
    && value.source.materialRevisionState === "current" && value.valueStatus === "reported"
    && value.value !== null && value.comparability === "comparable"
    && assertion?.category === "actual" && assertion.sourceChecked === true
    && !!assertion.businessScope && !!assertion.measurementBasis
    && ["verified", "owner_confirmed", "source_text_verified"].includes(value.provenance.verificationStatus)
    && (assertion.verification?.valueVerification === "source_text_verified"
      || assertion.verification?.valueVerification === "owner_confirmed")
    && (assertion.verification?.structureVerification === "source_labels_verified"
      || assertion.verification?.structureVerification === "owner_confirmed")
    && (value.source.snapshotCitation === undefined || !!assertion.snapshotTextBinding)
    && (metrics as readonly string[]).includes(value.metric);
}

function basisKey(value: Value): string {
  return JSON.stringify([value.membershipId, value.membershipVersionAtWrite, value.symbol, value.scope,
    value.currency, value.assertion?.businessScope ?? "unknown", value.assertion?.measurementBasis ?? "unknown"]);
}

function normalizedAmount(value: Value): string {
  const [whole, fraction = ""] = value.value!.split(".");
  const sign = whole.startsWith("-") ? -1n : 1n;
  const magnitude = BigInt(whole.replace("-", "") + fraction) * BigInt(value.unitScale)
    * 10n ** BigInt(6 - fraction.length);
  return String(sign * magnitude);
}

function periodType(value: Value): "annual" | "interim" {
  const start = value.periodStart!, end = value.periodEnd;
  const days = Math.round((Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 86400000) + 1;
  const explicitAnnual = /^year ended\b/i.test(value.assertion?.structureBinding?.columnHeaderText ?? "")
    || !!value.assertion?.structureConfirmation?.confirmedFields.includes("period");
  return days >= 365 && days <= 366 && ((start.slice(0, 4) === end.slice(0, 4)
    && start.endsWith("-01-01") && end.endsWith("-12-31")) || explicitAnnual) ? "annual" : "interim";
}

function periodCoverage(values: Value[], start: string, end: string, type: "annual" | "interim"): ResearchFinancialPeriodCoverage {
  const status = Object.fromEntries(metrics.map(metric => {
    const observed = values.filter(value => value.metric === metric && value.periodEnd === end
      && (durationMetrics.has(metric) ? value.periodKind === "duration" && value.periodStart === start
        : value.periodKind === "instant" && value.periodStart === null));
    const current=observed.filter(value=>value.valueState==="current");
    const matching=current.length?current:observed;
    const distinct = new Set(matching.filter(value => value.valueStatus === "reported" && value.value !== null).map(normalizedAmount));
    return [metric, matching.some(qualifies) && distinct.size === 1
      && matching.every(value => value.valueStatus === "reported" && value.value !== null) ? "available" : "unknown"];
  })) as ResearchFinancialPeriodCoverage["metrics"];
  return { periodStart: start, periodEnd: end, periodType: type,
    status: Object.values(status).every(item => item === "available") ? "complete" : "unknown", metrics: status };
}

function nextDay(day: string): string {
  return new Date(Date.parse(day + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
}
/** Coverage is evidence-limited: a latest required filing needs a separately sourced fiscal calendar. */
export function buildHonestResearchFinancialCoverage(values: Value[]): ResearchFinancialCoverage {
  const groups = new Map<string, Basis>();
  for (const value of values.filter(value => value.assertion?.category !== "guidance"
    && (metrics as readonly string[]).includes(value.metric))) {
    const key = basisKey(value);
    if (!groups.has(key)) groups.set(key, { key, values: [] });
    groups.get(key)!.values.push(value);
  }
  const candidates = [...groups.values()].map(group => {
    const spans = new Map<string, { start: string; end: string; type: "annual" | "interim" }>();
    for (const value of group.values) if (value.periodKind === "duration" && value.periodStart && durationMetrics.has(value.metric)) {
      const type = periodType(value), key = JSON.stringify([value.periodStart, value.periodEnd, type]);
      spans.set(key, { start: value.periodStart, end: value.periodEnd, type });
    }
    const periods = [...spans.values()].map(span => periodCoverage(group.values, span.start, span.end, span.type))
      .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || b.periodStart!.localeCompare(a.periodStart!));
    const annual = periods.filter(period => period.periodType === "annual");
    let continuous = 0;
    for (const period of annual) {
      if (continuous === 0) {
        if (period.status !== "complete") break;
        continuous = 1;
      } else {
        const previous = annual[continuous - 1]!;
        if (period.status !== "complete" || nextDay(period.periodEnd) !== previous.periodStart) break;
        continuous++;
      }
    }
    return { group, periods, continuous, latestAnnualEnd: annual[0]?.periodEnd ?? "" };
  }).sort((a, b) => b.latestAnnualEnd.localeCompare(a.latestAnnualEnd) || b.continuous - a.continuous);
  const latestAnnualEnd = candidates[0]?.latestAnnualEnd ?? "";
  const relevant = candidates.filter(item => item.latestAnnualEnd === latestAnnualEnd);
  const bestCount = relevant[0]?.continuous ?? 0;
  const best = relevant.filter(item => item.continuous === bestCount);
  const selected = best.length === 1 ? best[0]! : null;
  const periods = selected?.periods ?? [];
  const latestInterim = periods.find(period => period.periodType === "interim") ?? null;
  const historicalStatus = selected && bestCount >= RESEARCH_FINANCIAL_REQUIRED_ANNUAL_PERIODS ? "available" : "unknown";
  const gaps: string[] = [];
  if (best.length > 1) gaps.push("multiple accounting bases cannot be selected automatically");
  if (bestCount < RESEARCH_FINANCIAL_REQUIRED_ANNUAL_PERIODS)
    gaps.push(`five continuous, same-basis annual periods are not established; ${bestCount} consecutive periods verified from the latest observed annual period`);
  if (!latestInterim || latestInterim.status !== "complete") gaps.push("latest observed interim coverage is UNKNOWN");
  gaps.push("latest required filing is UNKNOWN without a sourced fiscal calendar and disclosure schedule");
  return { coverageVersion: "2026-10-10.honest-coverage.v2", status: "unknown", historicalStatus,
    latestRequiredStatus: "unknown", latestRequiredPeriodEnd: null,
    requiredAnnualPeriods: RESEARCH_FINANCIAL_REQUIRED_ANNUAL_PERIODS,
    completeAnnualPeriods: selected?.continuous ?? 0, latestInterimPeriodEnd: latestInterim?.periodEnd ?? null,
    latestInterimStatus: latestInterim?.status ?? "unknown", periods, gaps };
}

/** A requirement supplies the missing official-filing period boundary; facts still must prove every metric. */
export function buildSourcedResearchFinancialCoverage(values:Value[], requirement:import("./researchFinancialRequirement.js").ResearchFinancialRequirementData):ResearchFinancialCoverage {
  const groups=new Map<string,Basis>();
  for(const value of values.filter(value=>value.assertion?.category!=="guidance" && (metrics as readonly string[]).includes(value.metric))){
    const key=basisKey(value);if(!groups.has(key))groups.set(key,{key,values:[]});groups.get(key)!.values.push(value);
  }
  const expectedAnnualEnds:string[]=[];
  for(let i=0;i<RESEARCH_FINANCIAL_REQUIRED_ANNUAL_PERIODS;i++){
    const year=Number(requirement.latestRequiredAnnualPeriodEnd.slice(0,4))-i;
    expectedAnnualEnds.push(`${year}-${requirement.fiscalYearEnd}`);
  }
  const candidates=[...groups.values()].map(group=>{
    const spans=new Map<string,{start:string;end:string;type:"annual"|"interim"}>();
    for(const value of group.values)if(value.periodKind==="duration"&&value.periodStart&&durationMetrics.has(value.metric)){
      const type=periodType(value),key=JSON.stringify([value.periodStart,value.periodEnd,type]);
      spans.set(key,{start:value.periodStart,end:value.periodEnd,type});
    }
    const periods=[...spans.values()].map(span=>periodCoverage(group.values,span.start,span.end,span.type))
      .sort((a,b)=>b.periodEnd.localeCompare(a.periodEnd)||b.periodStart!.localeCompare(a.periodStart!));
    let count=0;
    for(let i=0;i<expectedAnnualEnds.length;i++){
      const end=expectedAnnualEnds[i]!,priorEnd=expectedAnnualEnds[i+1]
        ?? `${Number(end.slice(0,4))-1}-${requirement.fiscalYearEnd}`;
      const item=periods.find(period=>period.periodType==="annual"&&period.periodStart===nextDay(priorEnd)&&period.periodEnd===end);
      if(!item||item.status!=="complete")break;count++;
    }
    const interim=periods.find(period=>period.periodType==="interim"
      && period.periodStart===requirement.latestRequiredInterimPeriodStart
      && period.periodEnd===requirement.latestRequiredInterimPeriodEnd)??null;
    return {group,periods,count,interim};
  }).sort((a,b)=>b.count-a.count||(b.interim?.status==="complete"?1:0)-(a.interim?.status==="complete"?1:0));
  const best=candidates.filter(candidate=>candidate.count===(candidates[0]?.count??0)
    && (candidate.interim?.status==="complete") === (candidates[0]?.interim?.status==="complete"));
  const selected=best.length===1?best[0]:null;
  const count=selected?.count??0,interim=selected?.interim??null;
  const latestIsAnnual=requirement.latestRequiredAnnualPeriodEnd>requirement.latestRequiredInterimPeriodEnd;
  const latestAnnual=selected?.periods.find(period=>period.periodType==="annual"
    && period.periodEnd===requirement.latestRequiredAnnualPeriodEnd)??null;
  const latestRequiredStatus=(latestIsAnnual?latestAnnual:interim)?.status==="complete"?"available":"unknown";
  const gaps:string[]=[];
  if(best.length>1)gaps.push("multiple accounting bases cannot be selected automatically");
  if(count<RESEARCH_FINANCIAL_REQUIRED_ANNUAL_PERIODS)gaps.push(`five continuous same-basis annual periods ending ${requirement.latestRequiredAnnualPeriodEnd} are not established; ${count} verified`);
  if(interim?.status!=="complete")gaps.push(`required interim ${requirement.latestRequiredInterimPeriodStart} to ${requirement.latestRequiredInterimPeriodEnd} is UNKNOWN`);
  return {coverageVersion:"2026-10-10.sourced-coverage.v3",requirement,status:gaps.length?"unknown":"available",
    historicalStatus:count>=RESEARCH_FINANCIAL_REQUIRED_ANNUAL_PERIODS?"available":"unknown",
    latestRequiredStatus,
    latestRequiredPeriodEnd:latestIsAnnual?requirement.latestRequiredAnnualPeriodEnd:requirement.latestRequiredInterimPeriodEnd,
    requiredAnnualPeriods:RESEARCH_FINANCIAL_REQUIRED_ANNUAL_PERIODS,completeAnnualPeriods:count,
    latestInterimPeriodEnd:interim?.periodEnd??null,latestInterimStatus:interim?.status??"unknown",
    periods:selected?.periods??[],gaps};
}
