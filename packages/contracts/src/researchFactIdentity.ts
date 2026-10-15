import {operatingModelFingerprint,type OperatingFact,type OperatingPeriod} from "./researchOperatingModel.js";
/** Economic identity excludes source location and numeric value; assertion identity includes source revision. */
export interface FactIdentity {
  symbol:string;membershipVersion:number;metric:string;period:OperatingPeriod;category:string;
  unit:string;currency:string|null;accountingScope:string;businessScope:string;measurementBasis:string;
  taxonomy:{dimension:string;dimensionValue:string;parentNode:string|null;parentScope:string;overlapPolicy:string}|null;
  guidanceDefinition:string|null;shareBasis:"total"|"parent"|null;
}
export type EvidenceValidity="VALID"|"SUPERSEDED"|"RESTATED"|"RETRACTED"|"INVALID";
export type ResearchRecency="CURRENT_PERIOD"|"HISTORICAL"|"STALE_FOR_CURRENT_QUESTION"|"FUTURE"|"UNKNOWN";
export function factIdentity(f:Pick<OperatingFact,"symbol"|"membershipVersion"|"metric"|"period"|"category"|"unit"|"currency"|"unitScale"|"accountingScope"|"businessScope"|"measurementBasis"|"mix"|"guidance">):FactIdentity {
  return {shareBasis:null,symbol:f.symbol,membershipVersion:f.membershipVersion,metric:f.metric,period:f.period,category:f.category,unit:f.unit,currency:f.currency,accountingScope:f.accountingScope,businessScope:f.businessScope,measurementBasis:f.measurementBasis,taxonomy:f.mix?{dimension:f.mix.dimension,dimensionValue:f.mix.dimensionValue,parentNode:f.mix.parentNode??null,parentScope:f.mix.parentScope,overlapPolicy:f.mix.overlapPolicy??"overlapping"}:null,guidanceDefinition:f.category==="guidance"?f.guidance?.definition??null:null};
}
export const factIdentityKey=(f:FactIdentity):string=>operatingModelFingerprint(f);
export function assertionIdentity(f:OperatingFact):string{return operatingModelFingerprint({fact:factIdentity(f),rawValue:String(f.value),unitScale:f.unitScale,unitLabel:f.source.structureBinding?.unitHeaderText??f.unit,document:f.source.documentId,page:f.source.pageNumber,pageHash:f.source.pageTextSha256,material:f.source.materialId,revision:f.source.revision,valueRevision:f.revision,
  ...(f.source.snapshotCitation?{snapshot:f.source.snapshotCitation,snapshotOriginal:f.source.snapshotOriginal}: {})});}
export function seriesIdentity(f:FactIdentity):Omit<FactIdentity,"period">&{unitScale:1;periodKind:string;periodType:string}{const {period,...rest}=f;return {...rest,unitScale:1 as const,periodKind:period.kind,periodType:period.type};}
export function sameSeries(a:FactIdentity,b:FactIdentity):boolean{return operatingModelFingerprint(seriesIdentity(a))===operatingModelFingerprint(seriesIdentity(b));}
export function sameCalculationBasis(a:OperatingFact,b:OperatingFact):boolean {
  const x=factIdentity(a),y=factIdentity(b);return sameSeries({...x,metric:"input"},{...y,metric:"input"})&&operatingModelFingerprint(x.period)===operatingModelFingerprint(y.period)&&a.membershipId===b.membershipId&&a.comparability==="comparable"&&b.comparability==="comparable"&&a.category==="actual"&&b.category==="actual";
}
export function isValidFact(f:OperatingFact):boolean{return !f.evidenceValidity||f.evidenceValidity==="VALID";}
/** Multiple equal assertions are corroboration; different amounts never silently pick a winner. */
export function uniqueCurrentFact(facts:OperatingFact[]):OperatingFact|null {
  const current=facts.filter(isValidFact);if(!current.length)return null;
  if(new Set(current.map(f=>factIdentityKey(factIdentity(f)))).size!==1||new Set(current.map(f=>normalizedAmountKey(f.value,f.unitScale))).size!==1)return null;
  return [...current].sort((a,b)=>b.revision-a.revision||b.id.localeCompare(a.id))[0]!;
}
export function factRecency(f:OperatingFact,facts:OperatingFact[],asOf:string):ResearchRecency {
  if(f.period.end>asOf.slice(0,10))return "FUTURE";
  if(facts.some(other=>isValidFact(other)&&sameSeries(factIdentity(f),factIdentity(other))&&other.period.end>f.period.end&&other.period.end<=asOf.slice(0,10)))return "HISTORICAL";
  const age=(Date.parse(asOf)-Date.parse(f.period.end))/86400000;
  const cadence:{[key:string]:number}={monthly:62,interim:275,annual:455,ytd:62,weekly:14};
  if(cadence[f.period.type]===undefined)return "UNKNOWN";
  return age>cadence[f.period.type]! ? "STALE_FOR_CURRENT_QUESTION":"CURRENT_PERIOD";
}
export type RequirementField<T>={mode:"exact";value:T}|{mode:"any"}|{mode:"owner_to_define"};
export type EvidenceRequirement={ [K in keyof FactIdentity]:RequirementField<FactIdentity[K]> }&{comparability:RequirementField<OperatingFact["comparability"]>};
export function exactRequirement(identity:FactIdentity):EvidenceRequirement {return {...Object.fromEntries(Object.entries(identity).map(([k,value])=>[k,{mode:"exact",value}])),comparability:{mode:"exact",value:"comparable"}} as EvidenceRequirement;}
export type EvidenceMismatch="SCOPE_MISMATCH"|"CURRENCY_MISMATCH"|"UNIT_MISMATCH"|"MULTIPLE_CURRENT_ASSERTIONS"|"CONFLICTING_ASSERTIONS"|"PERIOD_MISMATCH"|"MEASUREMENT_MISMATCH"|"SOURCE_NOT_FOUND"|"NOT_EXTRACTED"|"OWNER_ASSUMPTION_REQUIRED"|"TAXONOMY_MISMATCH"|"EVIDENCE_SUPERSEDED"|"EVIDENCE_RETRACTED"|"EVIDENCE_INVALID"|"MIXED_TEST_RESULTS";
export function requirementMismatch(identity:FactIdentity,comparability:string,requirement:EvidenceRequirement):EvidenceMismatch|null {
  for(const [key,rule]of Object.entries(requirement)){
    if(rule.mode==="owner_to_define")return "OWNER_ASSUMPTION_REQUIRED";
    if(rule.mode==="any")continue;
    const actual=key==="comparability"?comparability:identity[key as keyof FactIdentity];
    if(operatingModelFingerprint(actual)!==operatingModelFingerprint(rule.value)){
      if(key==="period")return "PERIOD_MISMATCH";if(key==="currency")return "CURRENCY_MISMATCH";
      if(key==="unit")return "UNIT_MISMATCH";if(key==="taxonomy")return "TAXONOMY_MISMATCH";
      if(["measurementBasis","category","comparability"].includes(key))return "MEASUREMENT_MISMATCH";return "SCOPE_MISMATCH";
    }
  }return null;
}
export function validEvidenceRequirement(value:unknown):value is EvidenceRequirement {
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const r=value as Record<string,unknown>,keys=["symbol","membershipVersion","metric","period","category","unit","currency","accountingScope","businessScope","measurementBasis","taxonomy","guidanceDefinition","shareBasis","comparability"];
  return Object.keys(r).sort().join()===keys.sort().join()&&Object.values(r).every(v=>!!v&&typeof v==="object"&&!Array.isArray(v)&&("mode" in v)&&(["any","owner_to_define"].includes(String(v.mode))?Object.keys(v).length===1:v.mode==="exact"&&Object.keys(v).sort().join()==="mode,value"&&"value" in v&&v.value!==undefined));
}
export function canonicalCurrentFacts(facts:OperatingFact[]):OperatingFact[] {
 const groups=new Map<string,OperatingFact[]>();for(const f of facts.filter(isValidFact)){const key=factIdentityKey(factIdentity(f));groups.set(key,[...(groups.get(key)??[]),f]);}
 return [...groups.values()].flatMap(group=>{const f=uniqueCurrentFact(group);return f?[f]:[];});
}
export function canonicalPeriod(kind:OperatingPeriod["kind"],start:string|null,end:string):OperatingPeriod {
 const days=start?(Date.parse(end)-Date.parse(start))/86400000+1:0;
 return {kind,start,end,type:kind==="instant"?"instant":days>=365&&days<=366?"annual":days>=180&&days<=184?"interim":days>=28&&days<=31?"monthly":days===7?"weekly":start===`${end.slice(0,4)}-01-01`?"ytd":"other"};
}

/** Decimal string arithmetic is the only economic amount equality path. */
export function normalizedAmountKey(raw:string|number,scale:string|number):string {
 const decode=(input:string|number)=>{const v=String(input),m=/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(v);if(!m)throw new TypeError("invalid exact decimal");const exponent=Number(m[4]??0),places=(m[3]??"").length-exponent;if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>100)return null;return {coefficient:BigInt((m[1]??"")+(m[2]??"")+(m[3]??"")),places};};
 const a=decode(raw),b=decode(scale);if(!a||!b)throw new TypeError("decimal exponent out of range");let n=a.coefficient*b.coefficient,places=a.places+b.places;if(places<0){n*=10n**BigInt(-places);places=0;}
 while(places>0&&n%10n===0n){n/=10n;places--;}
 if(places===0)return String(n);
 const negative=n<0n,digits=String(negative?-n:n).padStart(places+1,"0");return (negative?"-":"")+digits.slice(0,-places)+"."+digits.slice(-places);
}
export function sameNormalizedAmount(left:string|number,leftScale:string|number,right:string|number,rightScale:string|number):boolean {try{return normalizedAmountKey(left,leftScale)===normalizedAmountKey(right,rightScale);}catch{return false;}}
export function normalizedAmountNumber(raw:string|number,scale:string|number):number|null {try{const value=Number(normalizedAmountKey(raw,scale));return Number.isFinite(value)&&Math.abs(value)<=Number.MAX_SAFE_INTEGER?value:null;}catch{return null;}}
