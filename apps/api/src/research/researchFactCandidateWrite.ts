import {durableEvidenceReminderExpiry} from "./researchEvidenceValidity.js";
import {readResearchFundamentals} from "./researchFundamentalRepository.js";
import {classifyCandidate,candidateExistingFacts} from "./researchFactCandidateRepository.js";
import type {Pool} from "pg";
import {ResearchDocumentError,type AuthenticatedResearchActor} from "./domain.js";
import {readDocumentFactCandidates} from "./researchFactCandidateRepository.js";
import type {StructuredFactCandidate} from "../../../../packages/contracts/src/researchFactCandidates.js";
import {readDeepResearchWorkspace} from "./deepResearchReadRepository.js";
import {confirmResearchDocumentFact} from "./researchDocumentWriteRepository.js";
import {readResearchDocumentPage,type ResearchDocumentRepositoryOptions} from "./researchDocumentRepository.js";
import {createResearchFundamentalValue} from "./researchFundamentalWriteRepository.js";
import {validateCreateResearchFundamentalValueRequest,type CreateResearchFundamentalValueRequest} from "../../../../packages/contracts/src/researchFundamentals.js";
/** A confirmation is an explicit user write. Candidate contents are re-extracted and page identity rechecked. */
export async function confirmStructuredFactCandidate(pool:Pool,membershipId:string,body:unknown,actor:AuthenticatedResearchActor,options:ResearchDocumentRepositoryOptions,now=new Date()) {
  if(!body||typeof body!=="object"||Array.isArray(body))throw invalid();
  const r=body as {candidateId:string;membershipVersion:number;ownerConfirmed:boolean;correctionConfirmed?:boolean;scopeOverride?:{originalScope:string;replacementScope:string;reason:string};value:CreateResearchFundamentalValueRequest;validUntil:string};
  if(Object.keys(r).some(k=>!["candidateId","membershipVersion","ownerConfirmed","correctionConfirmed","scopeOverride","value","validUntil"].includes(k))||r.ownerConfirmed!==true||!r.value||!validateCreateResearchFundamentalValueRequest(r.value).ok)throw invalid();
  if(hasClientSourceBinding(r.value))throw new ResearchDocumentError(422,"CANDIDATE_SOURCE_SERVER_ONLY","candidate page hash, excerpt and table bindings are rebuilt on the server; client-controlled bindings are rejected");
  const w=await readDeepResearchWorkspace(pool,membershipId,actor,now);
  const envelope=await readDocumentFactCandidates(pool,membershipId,actor,w.data?.operatingReasoning?.facts??[],now);
  let c:StructuredFactCandidate|undefined=envelope.candidates.find(c=>c.id===r.candidateId);
  if(!c||r.membershipVersion!==envelope.membershipVersion)throw new ResearchDocumentError(409,"CANDIDATE_DRIFT","candidate source or membership changed; reload");
  assertCandidateDocumentReview(c);
  const reviewed=reviewCandidateStructure(c,r.value,r.scopeOverride);
  c=classifyCandidate(reviewed,candidateExistingFacts((await readResearchFundamentals(pool,membershipId,actor,now)).values,envelope.membershipVersion));
  if(c.confirmationState==="already_confirmed")throw new ResearchDocumentError(409,"CANDIDATE_ALREADY_CONFIRMED","this source value already has numeric and structure confirmation; no duplicate revision is needed");
  if(["AMBIGUOUS","CONFLICTING_ASSERTION"].includes(c.classification??""))throw new ResearchDocumentError(422,"AMBIGUOUS_CANDIDATE","ambiguous candidates require source review, not one-click confirmation");
  if(["POSSIBLE_CORRECTION","CONFLICTING_ASSERTION"].includes(c.classification??"")&&r.correctionConfirmed!==true)throw new ResearchDocumentError(422,"CORRECTION_CONFIRMATION_REQUIRED","review old and proposed values explicitly");
  const value=structuredClone(r.value),a=value.assertion;
  if(c.existingFactId&&value.replacesValueId!==c.existingFactId)throw new ResearchDocumentError(409,"CANDIDATE_REVISION_REQUIRED","an existing fact requires an explicit append-only verification upgrade or correction");
  if(value.membershipVersion!==envelope.membershipVersion||value.metric!==c.metric||value.value!==c.proposedValue||value.periodStart!==c.periodStart||value.periodEnd!==c.periodEnd||value.currency!==c.currency||value.unitScale!==c.unitScale||!a||a.verification)throw invalid();
  const page=await readResearchDocumentPage(pool,membershipId,c.documentId,c.pageNumber,actor,options);
  if(page.pageTextSha256!==c.pageTextSha256)throw new ResearchDocumentError(409,"CANDIDATE_PAGE_DRIFT","candidate page text changed");
  if(c.sourceMaterialId&&value.sourceMaterialId!==c.sourceMaterialId)throw new ResearchDocumentError(409,"CANDIDATE_MATERIAL_DRIFT","candidate material revision changed");
  if(!c.sourceMaterialId){

    const material=await confirmResearchDocumentFact(pool,membershipId,c.documentId,{membershipVersion:envelope.membershipVersion,pageNumber:c.pageNumber,quote:c.sourceExcerpt,statement:`Owner 确认候选：${c.metric} ${c.proposedValue}`,validUntil:durableEvidenceReminderExpiry(),idempotencyKey:`candidate-material-${c.id}`},actor,options,now);
    value.sourceMaterialId=material.data.id;
  }
  if(r.scopeOverride){a.scopeOverride={...r.scopeOverride,confirmedBy:actor.actorId,confirmedAt:now.toISOString()};}
  if(c.mix)a.mix={...c.mix,parentScope:a.structureConfirmation?.confirmedFields.includes("scope")?a.businessScope:c.mix.parentScope};
  a.textBinding={documentId:c.documentId,pageNumber:c.pageNumber,pageTextSha256:c.pageTextSha256,sourceExcerpt:c.sourceExcerpt,rawValueText:c.rawValueText};
  a.structureBinding={rowLabelText:c.rowLabelText,columnHeaderText:c.columnHeaderText,unitHeaderText:c.unitHeaderText,structureExcerpt:c.structureExcerpt,ownerScopeConfirmed:false};
  // The fact must not predate a material created earlier in this confirmation request.
  return createResearchFundamentalValue(pool,membershipId,value,actor,new Date(Math.max(now.getTime(),Date.now())));
}
function invalid(){return new ResearchDocumentError(422,"INVALID_CANDIDATE_CONFIRMATION","explicit reviewed candidate fields and confirmation are required");}
function assertCandidateDocumentReview(candidate:StructuredFactCandidate){if(candidate.confirmationAllowed===false)throw new ResearchDocumentError(409,"DOCUMENT_REVIEW_REQUIRED","captured document version must be explicitly accepted before candidate confirmation");}

export function reviewCandidateStructure(c:import("../../../../packages/contracts/src/researchFactCandidates.js").StructuredFactCandidate,value:CreateResearchFundamentalValueRequest,override?:{originalScope:string;replacementScope:string;reason:string}){
  const assertion=value.assertion!;
  if(assertion.measurementBasis!==c.measurementBasis||assertion.unit!==c.unit||assertion.category!==(c.category??"actual"))throw new ResearchDocumentError(422,"CANDIDATE_BASIS_MISMATCH","measurement basis, unit and category are bound by the server extractor");
  if(c.accountingScope!=="unknown"&&value.scope!==c.accountingScope)throw new ResearchDocumentError(422,"CANDIDATE_SCOPE_MISMATCH","accounting scope differs from captured source labels");
  if(c.businessScope!=="unknown"&&assertion.businessScope!==c.businessScope){
    if(!override||override.originalScope!==c.businessScope||override.replacementScope!==assertion.businessScope||override.reason.trim().length<5||override.reason.length>500||!assertion.structureConfirmation?.confirmedFields.includes("scope"))throw new ResearchDocumentError(422,"EXTRACTED_SCOPE_OVERRIDE_REQUIRED","known template scope requires explicit override with original scope, replacement and reason");
  }else if(override)throw new ResearchDocumentError(422,"UNNECESSARY_SCOPE_OVERRIDE","scope override requires a changed known template scope");
  if((assertion.businessScope!==c.businessScope||c.accountingScope==="unknown")&&!assertion.structureConfirmation?.confirmedFields.includes("scope"))throw new ResearchDocumentError(422,"CANDIDATE_SCOPE_CONFIRMATION_REQUIRED","accounting and business scopes require explicit confirmation");
  return {...c,accountingScope:value.scope,businessScope:assertion.businessScope,...(c.mix?{mix:{...c.mix,parentScope:assertion.businessScope}}:{})};

}

function hasClientSourceBinding(value:CreateResearchFundamentalValueRequest):boolean{return !!(value.assertion?.textBinding||value.assertion?.structureBinding||value.assertion?.scopeOverride);}
