import {transmissionNodes} from "./researchOperatingCalculations.js";
import {operatingModelFingerprint,type OperatingFact,type OperatingPeriod} from "./researchOperatingModel.js";
import {factIdentity,seriesIdentity,sameSeries,isValidFact,uniqueCurrentFact,normalizedAmountNumber,type FactIdentity} from "./researchFactIdentity.js";
import {calculateProductMix} from "./researchProductMix.js";
export interface SeriesObservation {period:OperatingPeriod;value:number|null;status:"COMPARABLE"|"CONFLICTING_ASSERTIONS"|"NO_VALID_ASSERTION";assertionIds:string[];historicalAssertionIds:string[];inputs:string[];semanticType:"FACT"|"INTERPRETATION"|"UNKNOWN";formula:string|null}
export interface EvidenceSeries {id:string;identity:ReturnType<typeof seriesIdentity>;observations:SeriesObservation[];current:SeriesObservation|null;previous:SeriesObservation|null;change:number|null;changeRatio:number|null;breaks:string[];shareBasis?:"total"|"parent"}
export function previousComparableObservation(observations:SeriesObservation[],current:SeriesObservation,reference:"previous_year"|"previous_period"):SeriesObservation|null {
  const period=current.period;
  const end=reference==="previous_year"?`${Number(period.end.slice(0,4))-1}${period.end.slice(4)}`:period.start?new Date(Date.parse(period.start)-86400000).toISOString().slice(0,10):null;
  const start=reference==="previous_year"&&period.start?`${Number(period.start.slice(0,4))-1}${period.start.slice(4)}`:undefined;
  return observations.find(o=>o.period.end===end&&(start===undefined||o.period.start===start)&&o.status==="COMPARABLE")??null;
}
function assemble(identity:ReturnType<typeof seriesIdentity>,observations:SeriesObservation[],shareBasis?:"total"|"parent"):EvidenceSeries {
  observations.sort((a,b)=>a.period.end.localeCompare(b.period.end));const current=observations.at(-1)??null;
  const previous=current?previousComparableObservation(observations,current,"previous_year"):null;
  const change=current?.value!==null&&current?.value!==undefined&&previous?.value!==null&&previous?.value!==undefined?current.value-previous.value:null;
  return {id:operatingModelFingerprint({identity,shareBasis:shareBasis??null}),identity,observations,current,previous,change,changeRatio:change!==null&&previous?.value?change/Math.abs(previous.value):null,breaks:[],...(shareBasis?{shareBasis}:{})};
}
export function evidenceSeries(facts:OperatingFact[]):EvidenceSeries[] {
  const groups=new Map<string,OperatingFact[]>();
  for(const f of facts){const key=operatingModelFingerprint(seriesIdentity(factIdentity(f)));groups.set(key,[...(groups.get(key)??[]),f]);}
  const result=[...groups.values()].map(group=>{
    const periods=[...new Set(group.map(f=>operatingModelFingerprint(f.period)))];
    const observations=periods.map(key=>{const rows=group.filter(f=>operatingModelFingerprint(f.period)===key),valid=rows.filter(f=>isValidFact(f)&&f.comparability==="comparable"),one=uniqueCurrentFact(valid);
      return {period:rows[0]!.period,value:one?normalizedAmountNumber(one.value,one.unitScale):null,status:one?"COMPARABLE" as const:valid.length?"CONFLICTING_ASSERTIONS" as const:"NO_VALID_ASSERTION" as const,assertionIds:valid.map(f=>f.id),historicalAssertionIds:rows.filter(f=>!isValidFact(f)).map(f=>f.id),inputs:one?[one.id]:[],semanticType:one?"FACT" as const:"UNKNOWN" as const,formula:null};});
    return assemble(seriesIdentity(factIdentity(group[0]!)),observations);
  });
  for(const revenue of result.filter(s=>s.identity.metric==="revenue"&&s.identity.category==="actual")){
    for(const metric of ["gross_margin","operating_profit","capital_expenditure","free_cash_flow"]){
      const observations=revenue.observations.map(o=>{const r=facts.find(f=>f.id===o.inputs[0]),node=r?transmissionNodes(facts.filter(isValidFact),r).find(n=>n.metric===metric):null;
        return {...o,value:node?.value??null,status:node?.value!==null&&node?.value!==undefined?"COMPARABLE" as const:"NO_VALID_ASSERTION" as const,inputs:node?.inputs??[],semanticType:node?.semanticType==="INTERPRETATION"?"INTERPRETATION" as const:node?.semanticType==="FACT"?"FACT" as const:"UNKNOWN" as const,formula:node?.calculation??null};});
      const identity={...revenue.identity,metric,unit:metric==="gross_margin"?"ratio":"currency",currency:metric==="gross_margin"?null:revenue.identity.currency,unitScale:1 as const};
      if(!result.some(s=>operatingModelFingerprint(s.identity)===operatingModelFingerprint(identity)))result.push(assemble(identity,observations));
    }
  }
  const mixGroups=new Map<string,{identity:ReturnType<typeof seriesIdentity>;shareBasis:"total"|"parent";observations:SeriesObservation[]}>();
  for(const total of facts.filter(f=>f.metric==="sales_volume"&&isValidFact(f))){for(const m of calculateProductMix(facts.filter(isValidFact),total)){
    const f=facts.find(f=>f.id===m.factId)!;const identity={...seriesIdentity(factIdentity(f)),metric:"mix_share",shareBasis:m.shareBasis,unit:"ratio",unitScale:1 as const,currency:null};const key=operatingModelFingerprint({identity,shareBasis:m.shareBasis});const g=mixGroups.get(key)??{identity,shareBasis:m.shareBasis,observations:[]};
    if(!g.observations.some(o=>o.period.end===f.period.end))g.observations.push({period:f.period,value:m.value,status:m.value===null?"NO_VALID_ASSERTION":"COMPARABLE",assertionIds:[f.id],historicalAssertionIds:[],inputs:[m.factId,m.totalFactId],semanticType:m.value===null?"UNKNOWN":"INTERPRETATION",formula:m.formula});mixGroups.set(key,g);
  }}
  result.push(...[...mixGroups.values()].map(g=>assemble(g.identity,g.observations,g.shareBasis)));
  for(const series of result){const others=result.filter(s=>s.id!==series.id&&s.identity.metric===series.identity.metric&&s.identity.symbol===series.identity.symbol&&s.identity.periodType===series.identity.periodType);if(others.some(s=>s.identity.measurementBasis!==series.identity.measurementBasis))series.breaks.push("Series break: measurement basis changed");if(others.some(s=>s.identity.taxonomy?.dimensionValue===series.identity.taxonomy?.dimensionValue&&operatingModelFingerprint(s.identity.taxonomy)!==operatingModelFingerprint(series.identity.taxonomy)))series.breaks.push("Taxonomy changed / distinct taxonomy");}
  return result;
}
export function comparableFacts(facts:OperatingFact[],current:OperatingFact,reference:"previous_year"|"previous_period"):OperatingFact|null {
  const series=evidenceSeries(facts.filter(f=>sameSeries(factIdentity(f),factIdentity(current))))[0],observation=series?.observations.find(o=>o.period.end===current.period.end);
  const previous=series&&observation?previousComparableObservation(series.observations,observation,reference):null;return previous?uniqueCurrentFact(facts.filter(f=>previous.inputs.includes(f.id))):null;
}
export function seriesForIdentity(series:EvidenceSeries[],identity:FactIdentity):EvidenceSeries|undefined{return series.find(s=>operatingModelFingerprint(s.identity)===operatingModelFingerprint(seriesIdentity(identity)));}
