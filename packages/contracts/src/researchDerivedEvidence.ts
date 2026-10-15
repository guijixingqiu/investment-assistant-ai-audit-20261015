import {operatingModelFingerprint} from "./researchOperatingModel.js";
import {factIdentity,normalizedAmountKey,type EvidenceRequirement} from "./researchFactIdentity.js";
import {candidateFactIdentity,type StructuredFactCandidate} from "./researchFactCandidates.js";
import type {OperatingFact} from "./researchOperatingModel.js";

export interface DerivedEvidenceDependency {metric:string;role:string;factIds:string[];candidateIds:string[];status:"FACT"|"CANDIDATE"|"MISSING"|"CONFLICT"}
export interface DerivedEvidenceGraph {target:string;formula:string;dependencies:DerivedEvidenceDependency[];availableDependencies:string[];missingDependencies:string[];candidateIds:string[];complete:boolean}
const formulas:Record<string,{keys:string[];formula:string}>={
 gross_margin:{keys:["gross_profit","revenue"],formula:"gross_profit / revenue"},
 operating_profit:{keys:["profit_before_tax","net_finance_income","associates_profit","joint_ventures_profit"],formula:"profit_before_tax - net_finance_income - associates_profit - joint_ventures_profit"},
 capital_expenditure:{keys:["property_plant_equipment_purchases","intangible_asset_purchases","land_lease_prepayments"],formula:"PPE + intangible + land lease cash purchases"},
 free_cash_flow:{keys:["operating_cash_flow","property_plant_equipment_purchases","intangible_asset_purchases","land_lease_prepayments"],formula:"OCF - PPE - intangible - land lease cash purchases"}
};
function commonMatches(requirement:EvidenceRequirement,identity:ReturnType<typeof factIdentity>):boolean {
 for(const key of ["symbol","membershipVersion","period","category","accountingScope","businessScope","measurementBasis"] as const){const rule=requirement[key];if(rule.mode!=="exact")return false;if(operatingModelFingerprint(rule.value)!==operatingModelFingerprint(identity[key]))return false;}
 return true;
}
function dependencyMatches(requirement:EvidenceRequirement,metric:string,identity:ReturnType<typeof factIdentity>):boolean {
 if(!commonMatches(requirement,identity)||identity.metric!==metric)return false;
 if(requirement.metric.mode!=="exact")return false;
 if(requirement.metric.value==="mix_share"){
  if(identity.unit!=="vehicles")return false;
  const taxonomy=requirement.taxonomy.mode==="exact"?requirement.taxonomy.value:null;
  if(!taxonomy)return false;
  if(metric==="product_mix_volume")return operatingModelFingerprint(identity.taxonomy)===operatingModelFingerprint(taxonomy);
  if(metric==="sales_volume")return identity.taxonomy===null;
  return identity.taxonomy?.dimension===taxonomy.dimension&&identity.taxonomy.dimensionValue===taxonomy.parentNode&&identity.taxonomy.parentScope===taxonomy.parentScope;
 }
 return identity.unit==="currency" && identity.currency!==null;
}
export function derivedEvidenceGraph(requirement:EvidenceRequirement,facts:OperatingFact[],candidates:StructuredFactCandidate[]):DerivedEvidenceGraph|null {
 const target=requirement.metric.mode==="exact"?requirement.metric.value:null;
 if(!target)return null;
 const mix=target==="mix_share",basis=requirement.shareBasis.mode==="exact"?requirement.shareBasis.value:null;
 const formula=mix?basis==="total"?{keys:["product_mix_volume","sales_volume"],formula:"subgroup / comparable total"}:basis==="parent"?{keys:["product_mix_volume","parent_product_mix_volume"],formula:"subgroup / comparable parent"}:null:formulas[target];
 if(!formula)return null;
 const dependencies=formula.keys.map((key):DerivedEvidenceDependency=>{
  const metric=key==="parent_product_mix_volume"?"product_mix_volume":key;
  const compatible=(identity:ReturnType<typeof factIdentity>)=>key==="parent_product_mix_volume"
    ? commonMatches(requirement,identity)&&identity.metric==="product_mix_volume"&&identity.unit==="vehicles"&&identity.taxonomy?.dimension===(requirement.taxonomy.mode==="exact"?requirement.taxonomy.value?.dimension:null)&&identity.taxonomy?.dimensionValue===(requirement.taxonomy.mode==="exact"?requirement.taxonomy.value?.parentNode:null)&&identity.taxonomy?.parentScope===(requirement.taxonomy.mode==="exact"?requirement.taxonomy.value?.parentScope:null)
    : dependencyMatches(requirement,metric,identity);
  const fs=facts.filter(f=>f.evidenceValidity!=="SUPERSEDED"&&f.evidenceValidity!=="RESTATED"&&f.evidenceValidity!=="RETRACTED"&&f.evidenceValidity!=="INVALID"&&f.comparability==="comparable"&&compatible(factIdentity(f)));
  const cs=candidates.filter(c=>c.comparability==="comparable"&&compatible(candidateFactIdentity(c)));
  let conflict=false;
  if(fs.length>1){try{conflict=new Set(fs.map(f=>normalizedAmountKey(f.value,f.unitScale))).size>1;}catch{conflict=true;}}
  return {metric,role:key,factIds:fs.map(f=>f.id),candidateIds:cs.map(c=>c.id),status:conflict?"CONFLICT":fs.length?"FACT":cs.length?"CANDIDATE":"MISSING"};
 });
 const monetary=dependencies.filter(d=>d.status==="FACT"||d.status==="CANDIDATE").flatMap(d=>[...facts.filter(f=>d.factIds.includes(f.id)).map(f=>f.currency),...candidates.filter(c=>d.candidateIds.includes(c.id)).map(c=>c.currency==="XXX"?null:c.currency)]).filter((x):x is string=>!!x);
 const consistentCurrency=mix||new Set(monetary).size<=1;
 const complete=dependencies.every(d=>d.status==="FACT"||d.status==="CANDIDATE")&&consistentCurrency;
 return {target,formula:formula.formula,dependencies,availableDependencies:dependencies.filter(d=>d.status!=="MISSING").map(d=>d.role),missingDependencies:dependencies.filter(d=>d.status==="MISSING"||d.status==="CONFLICT").map(d=>d.role).concat(consistentCurrency?[]:["same_currency"]),candidateIds:dependencies.flatMap(d=>d.candidateIds),complete};
}
