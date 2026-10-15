import {factIdentity,factIdentityKey,isValidFact,normalizedAmountKey,uniqueCurrentFact} from "./researchFactIdentity.js";
import type {OperatingFact} from "./researchOperatingModel.js";
export interface OperatingAnchorSelection {
 status:"AVAILABLE"|"AMBIGUOUS"|"UNAVAILABLE";
 selectedFactId:string|null;preferredMeasurementBasis:"issuer_sales";
 metric:"sales_volume"|"revenue";period:string|null;reason:string;
 availableSeries:Array<{measurementBasis:string;businessScope:string;period:string}>;
 conflictingAssertionIds:string[];
}
/** A different sales basis is another series. Conflicting preferred assertions block the operating lane. */
export function selectOperatingAnchor(facts:OperatingFact[]):OperatingAnchorSelection {
 const sales=facts.filter(f=>f.metric==="sales_volume"&&f.category==="actual"&&f.period.type==="monthly"&&isValidFact(f));
 const availableSeries=[...new Map(sales.map(f=>[`${f.measurementBasis}:${f.accountingScope}:${f.businessScope}:${f.period.end}`,{measurementBasis:f.measurementBasis,businessScope:f.businessScope,period:f.period.end}])).values()];
 const preferred=sales.filter(f=>f.measurementBasis==="issuer_sales"&&f.comparability==="comparable");
 if(sales.length&&!preferred.length)return {status:"UNAVAILABLE",selectedFactId:null,preferredMeasurementBasis:"issuer_sales",metric:"sales_volume",period:sales.map(f=>f.period.end).sort().at(-1)??null,reason:"Only alternate monthly sales measurement bases are available; issuer_sales is required for this operating chain.",availableSeries,conflictingAssertionIds:[]};
 if(preferred.length){
  const end=preferred.map(f=>f.period.end).sort().at(-1)!;const current=preferred.filter(f=>f.period.end===end);
  const ids=new Set(current.map(f=>factIdentityKey(factIdentity(f))));let amounts:string[];
  try{amounts=current.map(f=>normalizedAmountKey(f.value,f.unitScale));}catch{amounts=[];}
  const selected=ids.size===1&&new Set(amounts).size===1?uniqueCurrentFact(current):null;
  return {status:selected?"AVAILABLE":"AMBIGUOUS",selectedFactId:selected?.id??null,preferredMeasurementBasis:"issuer_sales",metric:"sales_volume",period:end,reason:selected?"Unique current issuer_sales monthly assertion":"Current issuer_sales month has competing scopes or conflicting current assertions; review before using an operating anchor.",availableSeries,conflictingAssertionIds:selected?[]:current.map(f=>f.id)};
 }
 const financial=facts.filter(f=>f.metric==="revenue"&&f.category==="actual"&&isValidFact(f)&&f.comparability==="comparable");
 if(!financial.length)return {status:"UNAVAILABLE",selectedFactId:null,preferredMeasurementBasis:"issuer_sales",metric:"revenue",period:null,reason:"No comparable current sales or revenue evidence",availableSeries,conflictingAssertionIds:[]};
 const end=financial.map(f=>f.period.end).sort().at(-1)!,current=financial.filter(f=>f.period.end===end),selected=uniqueCurrentFact(current);
 return {status:selected?"AVAILABLE":"AMBIGUOUS",selectedFactId:selected?.id??null,preferredMeasurementBasis:"issuer_sales",metric:"revenue",period:end,reason:selected?"No monthly sales series; latest comparable financial revenue used for the financial lane":"Latest comparable financial period has conflicting revenue assertions",availableSeries,conflictingAssertionIds:selected?[]:current.map(f=>f.id)};
}
