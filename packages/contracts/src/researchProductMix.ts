import {canonicalCurrentFacts} from "./researchFactIdentity.js";
import { operatingModelFingerprint, type OperatingFact } from "./researchOperatingModel.js";
export interface ProductMixShare {
  factId:string; totalFactId:string; dimension:string; dimensionValue:string; parentScope:string;
  parentNode:string|null; shareBasis:"total"|"parent"; overlapPolicy:"nested"|"mutually_exclusive"|"overlapping";
  value:number|null; semanticType:"INTERPRETATION"|"UNKNOWN"; derivationMethod:"deterministic_calculation"|"missing_evidence";
  formula:"subgroup volume / comparable total volume"|"subgroup volume / comparable parent volume"; limitation:string;
}
function comparable(a:OperatingFact,b:OperatingFact):boolean {
  return a.symbol===b.symbol&&a.membershipId===b.membershipId&&a.membershipVersion===b.membershipVersion&&operatingModelFingerprint(a.period)===operatingModelFingerprint(b.period)&&a.measurementBasis===b.measurementBasis&&a.accountingScope===b.accountingScope&&a.category==="actual"&&b.category==="actual"&&a.comparability==="comparable"&&b.comparability==="comparable"&&a.unit==="vehicles"&&b.unit==="vehicles"&&a.currency===b.currency;
}
export function calculateProductMix(facts:OperatingFact[],anchor:OperatingFact):ProductMixShare[] {
  facts=canonicalCurrentFacts(facts);
  return facts.filter(f=>f.mix&&f.category==="actual"&&operatingModelFingerprint(f.period)===operatingModelFingerprint(anchor.period)).flatMap(f=>{
    return (["total",...(f.mix!.parentNode?["parent"]:[])] as Array<"total"|"parent">).map(shareBasis=>{
      const totals=facts.filter(t=>comparable(t,f)&&(shareBasis==="total"?t.metric==="sales_volume"&&t.businessScope===f.mix!.parentScope:t.mix?.dimension===f.mix!.dimension&&t.mix.dimensionValue===f.mix!.parentNode&&t.mix.parentScope===f.mix!.parentScope));
      const duplicates=facts.filter(t=>t.mix?.dimension===f.mix!.dimension&&t.mix?.dimensionValue===f.mix!.dimensionValue&&t.mix?.parentScope===f.mix!.parentScope&&operatingModelFingerprint(t.period)===operatingModelFingerprint(f.period));
      const t=totals.length===1?totals[0]:undefined;
      const valid=!!t&&duplicates.length===1&&t.value>0&&f.value>=0&&f.value*f.unitScale<=t.value*t.unitScale;
      return {factId:f.id,totalFactId:t?.id??"",dimension:f.mix!.dimension,dimensionValue:f.mix!.dimensionValue,parentScope:f.mix!.parentScope,parentNode:f.mix!.parentNode??null,shareBasis,overlapPolicy:f.mix!.overlapPolicy??"overlapping",value:valid?f.value*f.unitScale/(t!.value*t!.unitScale):null,semanticType:valid?"INTERPRETATION" as const:"UNKNOWN" as const,derivationMethod:valid?"deterministic_calculation" as const:"missing_evidence" as const,formula:shareBasis==="parent"?"subgroup volume / comparable parent volume" as const:"subgroup volume / comparable total volume" as const,limitation:valid?"嵌套分类不能相加；不跨维度相加；占比不能证明 ASP 或毛利率改善。":"期间、口径、父范围或唯一性不匹配"};
    });
  });
}
/** Only explicitly disjoint siblings can be aggregated. Missing taxonomy fails closed. */
export function aggregateProductMix(facts:OperatingFact[]):number|null {
  if(!facts.length)return null;const first=facts[0]!;
  if(new Set(facts.map(f=>f.mix?.dimensionValue)).size!==facts.length)return null;
  if(facts.some(f=>!f.mix||!first.mix||!comparable(f,first)||f.mix.dimension!==first.mix.dimension||f.mix.parentScope!==first.mix.parentScope||f.mix.parentNode!==first.mix.parentNode||f.mix.overlapPolicy!=="mutually_exclusive"))return null;
  return facts.reduce((sum,f)=>sum+f.value*f.unitScale,0);
}
