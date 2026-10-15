import {factIdentity,factIdentityKey,canonicalPeriod,normalizedAmountKey,sameNormalizedAmount,type FactIdentity} from "../../../../packages/contracts/src/researchFactIdentity.js";
import {candidateFactIdentity} from "../../../../packages/contracts/src/researchFactCandidates.js";
import { readResearchFundamentals } from "./researchFundamentalRepository.js";
import type {Pool,PoolClient} from "pg";
import type {AuthenticatedResearchActor} from "./domain.js";
import {CandidateMembershipNotFoundError} from "./domain.js";
import {readCandidateMembershipById} from "./candidateMembershipPersistence.js";
import {extractFactCandidates,DEFAULT_EXTRACTOR_REGISTRY,type ExtractorTemplate,type StructuredFactCandidate} from "../../../../packages/contracts/src/researchFactCandidates.js";
import type {OperatingFact} from "../../../../packages/contracts/src/researchOperatingModel.js";
/** Bounded known-table extraction. Cache stores text-derived candidates only, never actor authorization or currentness. */
const cache=new Map<string,StructuredFactCandidate[]>();
interface CandidatePage {document_id:string;page_number:number;text_sha256:string;normalized_text:string;pdf_sha256:string;review_state:"TRUSTED"|"NEEDS_REVIEW"|"REJECTED";source_lead_id:string|null;active_trusted_document_id:string|null;pending_review_document_id:string|null;material_id:string|null;material_revision:number|null;source_url:string|null}
export async function readDocumentFactCandidates(pool:Pick<Pool|PoolClient,"query">,membershipId:string,actor:AuthenticatedResearchActor,_facts:OperatingFact[]=[],now=new Date(),historical=false,registry:readonly ExtractorTemplate[]=DEFAULT_EXTRACTOR_REGISTRY) {
  const member=await readCandidateMembershipById(pool,actor,membershipId);if(!member)throw new CandidateMembershipNotFoundError();
  const identity={symbol:member.symbol,membershipId,membershipVersion:Number(member.version)};
  const pages=await pool.query<CandidatePage>(`select p.document_id,p.page_number,p.text_sha256,p.normalized_text,d.pdf_sha256,coalesce(re.review_state,d.review_state) review_state,d.source_lead_id,l.active_trusted_document_id,l.pending_review_document_id,m.id as material_id,m.revision as material_revision,coalesce(m.source_url,d.captured_source_url) as source_url
    from research_documents d join candidate_memberships cm on cm.id=d.candidate_membership_id join research_document_pages p on p.document_id=d.id
    left join research_source_leads l on l.lead_id=d.source_lead_id
    left join lateral (select review_state from research_document_review_events where document_id=d.id order by event_sequence desc limit 1) re on true
    left join lateral (select rm.id,rm.revision,ei.source_url from research_materials rm join evidence_items ei on ei.id=rm.evidence_item_id where rm.candidate_membership_id=cm.id and rm.citation_document_id=d.id and rm.citation_page_number=p.page_number and rm.citation_page_text_sha256=p.text_sha256 and rm.claim_type='issuer_statement' and ei.source_type in ('owner_provided_pdf','issuer_public_pdf') and ${historical?"rm.created_at < $5::timestamptz + interval '1 millisecond' and (rm.deleted_at is null or rm.deleted_at >= $5::timestamptz + interval '1 millisecond')":"rm.deleted_at is null"} and not exists(select 1 from research_materials child where child.replaces_material_id=rm.id ${historical?"and child.created_at < $5::timestamptz + interval '1 millisecond'":""}) order by rm.id desc limit 1) m on true
    where d.candidate_membership_id=$1 and cm.actor_type=$2 and cm.actor_id=$3 and cm.version=$4 and d.captured_membership_version=$4 and cm.state='tracked'
    and d.imported_at < $5::timestamptz + interval '1 millisecond' and d.published_at<=$5
    and (cardinality($6::text[])=0 or exists(select 1 from unnest($6::text[]) hint where position(hint in p.normalized_text)>0))
    order by d.imported_at desc,d.id desc,p.page_number limit 24`,[membershipId,actor.actorType,actor.actorId,identity.membershipVersion,now,registry.flatMap(t=>t.pageHints??[])]);
  const fundamental=await readResearchFundamentals(pool,membershipId,actor,now,historical?now:undefined);
  const existing=candidateExistingFacts(fundamental.values,identity.membershipVersion);
  const candidates=pages.rows.flatMap(p=>{
    const key=[registry.map(t=>t.id).join(","),identity.symbol,membershipId,identity.membershipVersion,p.document_id,p.page_number,p.text_sha256,p.material_id,p.material_revision].join(":");
    let extracted=cache.get(key);
    if(!extracted){extracted=extractFactCandidates({documentId:String(p.document_id),pageNumber:Number(p.page_number),pageTextSha256:p.text_sha256,text:p.normalized_text,sourceUrl:p.source_url??""},identity,[],registry).map(c=>({...c,sourceMaterialId:p.material_id?String(p.material_id):null,materialRevision:p.material_revision?Number(p.material_revision):null,documentPdfSha256:p.pdf_sha256}));if(cache.size>=256)cache.delete(cache.keys().next().value!);cache.set(key,extracted);}
    return extracted.map(c=>({...classifyCandidate(c,existing),documentReviewState:p.review_state,confirmationAllowed:p.review_state==="TRUSTED"&&(!p.source_lead_id||String(p.active_trusted_document_id)===String(p.document_id)&&p.pending_review_document_id===null)}));
  });
  return {status:"available" as const,...identity,actorId:actor.actorId,candidates,extractionStatus:candidates.length?"CANDIDATES_AVAILABLE":"NO_SUPPORTED_TEMPLATE_OR_ROWS",scannedPages:pages.rows.length,pageLimit:24};
}
type CandidateExistingFact=Pick<OperatingFact,"id"|"metric"|"unitScale"|"currency"|"mix">&{identity?:FactIdentity;sourceUrl?:string;businessScope?:string;structuredVerified?:boolean;value:number|string;period:Pick<OperatingFact["period"],"start"|"end">;source:Pick<OperatingFact["source"],"documentId"|"pageNumber"|"materialId"|"revision">};
export function classifyCandidate(candidate:StructuredFactCandidate,facts:CandidateExistingFact[]):StructuredFactCandidate {
  const identity=candidateFactIdentity(candidate);
  const existing=facts.filter(f=>f.identity&&factIdentityKey(f.identity)===factIdentityKey(identity));
  const sameDocument=existing.filter(f=>f.source.documentId===candidate.documentId&&f.source.pageNumber===candidate.pageNumber);
  const one=sameDocument.length===1?sameDocument[0]:existing[0];
  const same=one&&sameNormalizedAmount(one.value,one.unitScale,candidate.proposedValue,candidate.unitScale);
  const different=facts.some(f=>f.metric===candidate.metric&&f.period.start===candidate.periodStart&&f.period.end===candidate.periodEnd&&!existing.includes(f));
  const classification:StructuredFactCandidate["classification"]=candidate.classification==="AMBIGUOUS"||!candidate.structureExcerpt?"AMBIGUOUS":[identity.accountingScope,identity.businessScope].includes("unknown")?"SCOPE_REVIEW_REQUIRED":existing.length>1&&new Set(existing.map(f=>normalizedAmountKey(f.value,f.unitScale))).size>1?"CONFLICTING_ASSERTION":!one?(different?"DISTINCT_FACT":"NEW_FACT"):!same?"POSSIBLE_CORRECTION":sameDocument.length?"VERIFICATION_UPGRADE":"ADDITIONAL_SOURCE";
  return {...candidate,confirmationState:classification==="VERIFICATION_UPGRADE"&&one?.structuredVerified?"already_confirmed":"review_required",classification,purpose:one?"verification_upgrade":"new_fact",existingFactId:classification==="ADDITIONAL_SOURCE"?null:one?.id??null};
}

export function candidateExistingFacts(values:import("../../../../packages/contracts/src/researchFundamentals.js").ResearchFundamentalValueData[],membershipVersion:number):CandidateExistingFact[]{return values.filter(f=>["current","historical_source_stale"].includes(f.valueState)&&f.value!==null&&f.membershipVersionAtWrite===membershipVersion&&f.source.kind!=="source_snapshot").map(f=>({identity:factIdentity({symbol:f.symbol,membershipVersion:f.membershipVersionAtWrite,metric:f.metric,period:canonicalPeriod(f.periodKind,f.periodStart,f.periodEnd),category:f.assertion?.category??"actual",unit:f.assertion?.unit??"currency",currency:f.currency==="XXX"?null:f.currency,unitScale:f.unitScale,accountingScope:f.scope,businessScope:f.assertion?.businessScope??"unknown",measurementBasis:f.assertion?.measurementBasis??"financial_statement",mix:f.assertion?.mix,guidance:f.assertion?.guidance}),id:f.id,sourceUrl:f.assertion?.sourceUrl,businessScope:f.assertion?.businessScope,structuredVerified:f.assertion?.verification?.valueVerification==="source_text_verified"&&["source_labels_verified","owner_confirmed"].includes(f.assertion?.verification?.structureVerification??""),metric:f.metric,value:f.value!,unitScale:f.unitScale,currency:f.currency==="XXX"?null:f.currency,period:{start:f.periodStart,end:f.periodEnd},mix:f.assertion?.mix,source:{documentId:f.source.documentId!,pageNumber:f.source.pageNumber!,materialId:f.source.materialId,revision:f.source.materialRevision}}));}
