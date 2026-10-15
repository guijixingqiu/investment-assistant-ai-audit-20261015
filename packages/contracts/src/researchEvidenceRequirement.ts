import {evidenceSeries} from "./researchEvidenceSeries.js";
import {derivedEvidenceGraph} from "./researchDerivedEvidence.js";
import {factIdentity,factIdentityKey,normalizedAmountKey,isValidFact,requirementMismatch,exactRequirement,type EvidenceRequirement,type EvidenceMismatch} from "./researchFactIdentity.js";
import {candidateFactIdentity,type StructuredFactCandidate} from "./researchFactCandidates.js";
import type {OperatingFact,OperatingPeriod} from "./researchOperatingModel.js";
export interface EvidenceRequirementResolution {status:"OPEN"|"EVIDENCE_FOUND"|"RESOLVED"|"BLOCKED"|"UNKNOWN";reason:EvidenceMismatch|null;evidenceIds:string[];candidateIds:string[];resolvedAt:string|null;availableDependencies?:string[];missingDependencies?:string[];dependencyGraph?:ReturnType<typeof derivedEvidenceGraph>}
export function metricRequirement(anchor:OperatingFact,metric:string,period:OperatingPeriod=anchor.period,currency:string|null=anchor.currency):EvidenceRequirement {
 const unit=metric==="average_selling_price"?"currency_per_vehicle":metric==="mix_share"||metric==="gross_margin"?"ratio":metric==="sales_volume"||metric==="product_mix_volume"?"vehicles":metric.includes("shares")?"shares":"currency";
 const requirement=exactRequirement({...factIdentity(anchor),metric,period,unit,currency:["currency","currency_per_vehicle"].includes(unit)?currency:null,category:"actual",taxonomy:metric==="product_mix_volume"||metric==="mix_share"?factIdentity(anchor).taxonomy:null,guidanceDefinition:null});
 if(["currency","currency_per_vehicle"].includes(unit)&&currency===null)requirement.currency={mode:"owner_to_define"};
 return requirement;
}
export function resolveEvidenceRequirement(requirement:EvidenceRequirement,facts:OperatingFact[],candidates:StructuredFactCandidate[]):EvidenceRequirementResolution {
 const metric=requirement.metric.mode==="exact"?requirement.metric.value:null;
 if(["mix_share","gross_margin","operating_profit","free_cash_flow","capital_expenditure"].includes(metric??""))return resolveDerivedRequirement(requirement,facts,candidates);
 const relevant=facts.filter(f=>isValidFact(f)&&(!metric||f.metric===metric)),matching=relevant.filter(f=>!requirementMismatch(factIdentity(f),f.comparability,requirement));
 const found=candidates.filter(c=>!requirementMismatch(candidateFactIdentity(c),c.comparability??"not_comparable",requirement));
 const values=new Set(matching.map(f=>`${factIdentityKey(factIdentity(f))}:${normalizedAmountKey(f.value,f.unitScale)}`));
 let status:"OPEN"|"EVIDENCE_FOUND"|"RESOLVED"|"BLOCKED"|"UNKNOWN"="OPEN",reason:EvidenceMismatch|null;
 if(values.size>1){status="BLOCKED";reason="CONFLICTING_ASSERTIONS";}
 else if(values.size===1){status="RESOLVED";reason=null;}
 else if(facts.some(f=>!isValidFact(f)&&!requirementMismatch(factIdentity(f),f.comparability,requirement))){status="BLOCKED";const removed=facts.find(f=>!isValidFact(f)&&!requirementMismatch(factIdentity(f),f.comparability,requirement));reason=removed?.evidenceValidity==="RETRACTED"?"EVIDENCE_RETRACTED":removed?.evidenceValidity==="INVALID"?"EVIDENCE_INVALID":"EVIDENCE_SUPERSEDED";}
 else if(found.length){status="EVIDENCE_FOUND";reason="NOT_EXTRACTED";}
 else {const candidate=candidates.find(c=>c.metric===metric);reason=relevant[0]?requirementMismatch(factIdentity(relevant[0]),relevant[0].comparability,requirement):candidate?requirementMismatch(candidateFactIdentity(candidate),candidate.comparability??"not_comparable",requirement):"SOURCE_NOT_FOUND";if(reason==="OWNER_ASSUMPTION_REQUIRED")status="UNKNOWN";}
 return {status,reason,evidenceIds:matching.map(f=>f.id),candidateIds:found.map(c=>c.id),resolvedAt:status==="RESOLVED"?matching.map(f=>f.recordedAt??f.source.publishedAt).sort().at(-1)??null:null};
}

function resolveDerivedRequirement(requirement:EvidenceRequirement,facts:OperatingFact[],candidates:StructuredFactCandidate[]):EvidenceRequirementResolution {
 const graph=derivedEvidenceGraph(requirement,facts,candidates);
 const matching=evidenceSeries(facts).flatMap(s=>s.observations.map(o=>({s,o}))).filter(({s,o})=>!requirementMismatch({...s.identity,period:o.period},o.status==="COMPARABLE"?"comparable":"not_comparable",requirement));
 const resolved=matching.filter(({o})=>o.status==="COMPARABLE"&&o.value!==null),conflicted=matching.some(({o})=>o.status==="CONFLICTING_ASSERTIONS");
 const status: "OPEN"|"EVIDENCE_FOUND"|"RESOLVED"|"BLOCKED"=conflicted||graph?.dependencies.some(d=>d.status==="CONFLICT")?"BLOCKED":resolved.length===1?"RESOLVED":resolved.length>1?"BLOCKED":graph?.complete&&graph.candidateIds.length?"EVIDENCE_FOUND":"OPEN";
 const reason:import("./researchFactIdentity.js").EvidenceMismatch|null=status==="RESOLVED"?null:status==="BLOCKED"?"CONFLICTING_ASSERTIONS":status==="EVIDENCE_FOUND"?"NOT_EXTRACTED":graph?.missingDependencies.length?"NOT_EXTRACTED":"SOURCE_NOT_FOUND";
 return {status,reason,evidenceIds:resolved.flatMap(({o})=>o.inputs),candidateIds:graph?.candidateIds??[],availableDependencies:graph?.availableDependencies??[],missingDependencies:graph?.missingDependencies??[],dependencyGraph:graph,resolvedAt:status==="RESOLVED"?facts.filter(f=>resolved.some(({o})=>o.inputs.includes(f.id))).map(f=>f.recordedAt??f.source.publishedAt).sort().at(-1)??null:null};
}
