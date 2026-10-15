import {randomUUID} from "node:crypto";
import type {Pool,PoolClient} from "pg";
import type {AuthenticatedResearchActor} from "./domain.js";
import {ResearchDocumentError} from "./domain.js";
import {readCandidateMembershipById} from "./candidateMembershipPersistence.js";
import {candidateFactIdentity} from "../../../../packages/contracts/src/researchFactCandidates.js";
import {requirementMismatch} from "../../../../packages/contracts/src/researchFactIdentity.js";
import {derivedEvidenceGraph} from "../../../../packages/contracts/src/researchDerivedEvidence.js";
import {canonicalSourceUrl,publicationDate,sourceLeadId,proposedLeadImpact,type ResearchSourceLead,type ResearchSourceLeadEvent,type ResearchSourceType,type ResearchDocumentKind,type ResearchSourceLeadStatus} from "../../../../packages/contracts/src/researchSourceIntake.js";
import type {StructuredFactCandidate} from "../../../../packages/contracts/src/researchFactCandidates.js";
import type {ResearchQuestion} from "../../../../packages/contracts/src/researchQuestions.js";
import type {ResearchOperatingReasoning} from "../../../../packages/contracts/src/researchOperatingReasoning.js";
export type SourceLeadProposal=Pick<ResearchSourceLead,"publisher"|"title"|"origin">&{publishedAt?:string;publicationDate?:string;url:string;sourceType:ResearchSourceType;documentKind:ResearchDocumentKind;providerCategory?:string|null};
interface LeadRow {lead_id:string;symbol:string;candidate_membership_id:string;captured_membership_version:number;source_type:ResearchSourceType;publisher:string;title:string;publication_date:Date|string;published_at:Date|string;discovered_at:Date|string;canonical_url:string;document_kind:ResearchDocumentKind;provider_category:string|null;status:ResearchSourceLeadStatus;origin:string;document_id:string|null;document_pdf_sha256:string|null;review_reason:string|null;status_changed_at:Date|string;last_checked_at:Date|string|null;latest_observed_document_id:string|null;latest_observed_pdf_sha256:string|null;active_trusted_document_id:string|null;active_trusted_pdf_sha256:string|null;pending_review_document_id:string|null;last_fetch_attempt_at:Date|string|null;last_fetch_success_at:Date|string|null;last_fetch_failure_code:string|null;consecutive_fetch_failures:number;next_retry_at:Date|string|null}
function iso(x:Date|string){return new Date(x).toISOString();}
function lead(row:LeadRow) {const d=row.publication_date,date=typeof d==="string"?d.slice(0,10):`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;return {leadId:row.lead_id,symbol:row.symbol,membershipId:String(row.candidate_membership_id),membershipVersion:Number(row.captured_membership_version),sourceType:row.source_type,publisher:row.publisher,title:row.title,publicationDate:date,publishedAt:iso(row.published_at),discoveredAt:iso(row.discovered_at),canonicalUrl:row.canonical_url,documentKind:row.document_kind,status:row.status,origin:row.origin,documentId:row.document_id?String(row.document_id):null,documentPdfSha256:row.document_pdf_sha256,reviewReason:row.review_reason,statusChangedAt:iso(row.status_changed_at),lastCheckedAt:row.last_checked_at?iso(row.last_checked_at):null};}
function leadV2(row:LeadRow):ResearchSourceLead {
 return {...lead(row),providerCategory:row.provider_category,latestObservedDocumentId:row.latest_observed_document_id?String(row.latest_observed_document_id):null,latestObservedPdfSha256:row.latest_observed_pdf_sha256,activeTrustedDocumentId:row.active_trusted_document_id?String(row.active_trusted_document_id):null,activeTrustedPdfSha256:row.active_trusted_pdf_sha256,pendingReviewDocumentId:row.pending_review_document_id?String(row.pending_review_document_id):null,lastFetchAttemptAt:row.last_fetch_attempt_at?iso(row.last_fetch_attempt_at):null,lastFetchSuccessAt:row.last_fetch_success_at?iso(row.last_fetch_success_at):null,lastFetchFailureCode:row.last_fetch_failure_code,consecutiveFetchFailures:Number(row.consecutive_fetch_failures??0),nextRetryAt:row.next_retry_at?iso(row.next_retry_at):null};
}
export async function listSourceLeads(pool:Pick<Pool|PoolClient,"query">,membershipId:string,actor:AuthenticatedResearchActor):Promise<ResearchSourceLead[]>{
 const rows=await pool.query<LeadRow>(`select l.* from research_source_leads l join candidate_memberships cm on cm.id=l.candidate_membership_id where l.candidate_membership_id=$1 and cm.actor_type=$2 and cm.actor_id=$3 and cm.version=l.captured_membership_version and cm.symbol=l.symbol order by l.status_changed_at desc,l.lead_id desc`,[membershipId,actor.actorType,actor.actorId]);return rows.rows.map(leadV2);
}
export async function listSourceLeadHistory(pool:Pick<Pool|PoolClient,"query">,membershipId:string,actor:AuthenticatedResearchActor,beforeLeadId?:string,limit=50):Promise<{leads:ResearchSourceLead[];nextBeforeLeadId:string|null}>{
 const size=Math.min(100,Math.max(1,limit));
 const rows=await pool.query<LeadRow>(`select l.* from research_source_leads l join candidate_memberships cm on cm.id=l.candidate_membership_id
 where l.candidate_membership_id=$1 and cm.actor_type=$2 and cm.actor_id=$3 and cm.version=l.captured_membership_version and cm.symbol=l.symbol
 and ($4::text is null or (l.status_changed_at,l.lead_id)<(select previous.status_changed_at,previous.lead_id from research_source_leads previous where previous.lead_id=$4 and previous.candidate_membership_id=$1))
 order by l.status_changed_at desc,l.lead_id desc limit $5`,[membershipId,actor.actorType,actor.actorId,beforeLeadId??null,size+1]);
 const page=rows.rows.slice(0,size).map(leadV2);
 return {leads:page,nextBeforeLeadId:rows.rows.length>size?page.at(-1)!.leadId:null};
}
export async function upsertSourceLead(pool:Pool,membershipId:string,actor:AuthenticatedResearchActor,proposal:SourceLeadProposal,now=new Date()):Promise<ResearchSourceLead>{
 const member=await readCandidateMembershipById(pool,actor,membershipId);if(!member||member.state!=="tracked")throw new TypeError("current tracked membership required");
 const url=canonicalSourceUrl(proposal.url),date=publicationDate(proposal.publicationDate??proposal.publishedAt??"");
 const publishedAt=`${date}T00:00:00.000Z`;if(Date.parse(publishedAt)>now.getTime())throw new TypeError("future publication is not a source lead");
 const id=sourceLeadId({symbol:member.symbol,membershipId,membershipVersion:Number(member.version),url,publicationDate:date,documentKind:proposal.documentKind});
 const status:ResearchSourceLeadStatus="DISCOVERED";
 const client=await pool.connect();try {await client.query("begin");
 const rows=await client.query<LeadRow>(`insert into research_source_leads(lead_id,candidate_membership_id,captured_membership_version,symbol,source_type,publisher,title,publication_date,published_at,discovered_at,canonical_url,document_kind,status,origin,provider_category,status_changed_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$10) on conflict do nothing returning *`,[id,membershipId,member.version,member.symbol,proposal.sourceType,proposal.publisher,proposal.title,date,publishedAt,now,url,proposal.documentKind,status,proposal.origin,proposal.providerCategory??null]);
 if(rows.rows[0])await appendEvent(client,id,null,status,null,null,null,now,actor,"SOURCE_DISCOVERED",null,null);
 const existing=rows.rows[0]??(await client.query<LeadRow>(`select l.* from research_source_leads l join candidate_memberships cm on cm.id=l.candidate_membership_id where l.candidate_membership_id=$1 and l.captured_membership_version=$2 and l.canonical_url=$3 and l.publication_date=$4 and l.document_kind=$5 and cm.actor_type=$6 and cm.actor_id=$7 and cm.version=l.captured_membership_version order by l.discovered_at,l.lead_id limit 1`,[membershipId,member.version,url,date,proposal.documentKind,actor.actorType,actor.actorId])).rows[0];if(!existing)throw new TypeError("source lead identity conflict");
 // A natural-key match may retain a lead ID generated before the current fingerprint.
 const persistedLeadId=existing.lead_id;
 let current=existing;
 if(!rows.rows[0]&&sourceAuthority(proposal.sourceType)>sourceAuthority(existing.source_type)){
  const category=proposal.providerCategory?.trim()||null;
  const placeholder=(value:string)=>!value.trim()||/^(unknown|untitled|official disclosure|source lead)$/i.test(value.trim());
  const enrichedCategory=category&&!existing.provider_category?category:existing.provider_category;
  const enrichedTitle=placeholder(existing.title)&&!placeholder(proposal.title)?proposal.title:existing.title;
  const enrichedPublisher=placeholder(existing.publisher)&&!placeholder(proposal.publisher)?proposal.publisher:existing.publisher;
  const enriched=[enrichedCategory!==existing.provider_category?"category":null,enrichedTitle!==existing.title?"title":null,enrichedPublisher!==existing.publisher?"publisher":null].filter(Boolean);
  if(enriched.length){
   current=(await client.query<LeadRow>(`update research_source_leads set provider_category=$2,title=$3,publisher=$4 where lead_id=$1 returning *`,[persistedLeadId,enrichedCategory,enrichedTitle,enrichedPublisher])).rows[0]??current;
   await appendEvent(client,persistedLeadId,existing.status,existing.status,existing.document_id,existing.document_pdf_sha256,`Authoritative provider completed ${enriched.join(", ")}`,now,actor,"SOURCE_METADATA_ENRICHED",existing.document_id,existing.document_pdf_sha256);
  }
  const conflicts=[category&&existing.provider_category&&category!==existing.provider_category?"category":null,proposal.title!==enrichedTitle?"title":null,proposal.publisher!==enrichedPublisher?"publisher":null].filter(Boolean);
  if(conflicts.length){
   const reason=`More authoritative provider proposed different ${conflicts.join(", ")}; original capture metadata retained`;
   const prior=(await client.query<{reason_snapshot:string|null}>(`select reason_snapshot from research_source_lead_events where lead_id=$1 and event_type='SOURCE_METADATA_CONFLICT' order by event_sequence desc limit 1`,[persistedLeadId])).rows[0];
   if(prior?.reason_snapshot!==reason)await appendEvent(client,persistedLeadId,existing.status,existing.status,existing.document_id,existing.document_pdf_sha256,reason,now,actor,"SOURCE_METADATA_CONFLICT",existing.document_id,existing.document_pdf_sha256);
  }
 }
 await client.query("commit");return leadV2(current);
 }catch(error){await client.query("rollback");throw error;}finally{client.release();}
}
function sourceAuthority(source:ResearchSourceType):number{return source==="hkex_official"?3:source==="issuer_ir"?2:source==="owner_url"?1:0;}
const transitions:Record<ResearchSourceLeadStatus,ResearchSourceLeadStatus[]>={DISCOVERED:["SUPPORTED","NEEDS_REVIEW","REJECTED"],SUPPORTED:["IMPORTED","DUPLICATE","NEEDS_REVIEW","REJECTED"],IMPORTED:["DUPLICATE","NEEDS_REVIEW","REJECTED"],DUPLICATE:["IMPORTED","NEEDS_REVIEW","REJECTED"],NEEDS_REVIEW:["IMPORTED","DUPLICATE","REJECTED"],REJECTED:["NEEDS_REVIEW"]};
async function appendEvent(client:PoolClient,leadId:string,from:ResearchSourceLeadStatus|null,to:ResearchSourceLeadStatus,documentId:string|null,hash:string|null,reason:string|null,now:Date,actor:AuthenticatedResearchActor,eventType:string,previousDocumentId:string|null,previousHash:string|null,reasonCode=eventType){
 await client.query(`insert into research_source_lead_events(event_id,lead_id,from_status,to_status,document_id,pdf_sha256,reason,observed_at,actor_type,actor_id,event_type,previous_document_id,previous_pdf_sha256,reason_code,reason_snapshot) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,[randomUUID(),leadId,from,to,documentId,hash,reason,now,actor.actorType,actor.actorId,eventType,previousDocumentId,previousHash,reasonCode,reason]);
}
export async function setLeadStatus(pool:Pool,current:ResearchSourceLead,actor:AuthenticatedResearchActor,status:ResearchSourceLeadStatus,documentId:string|null,hash:string|null,reason:string|null,now=new Date(),eventType="SOURCE_STATUS_CHANGED",reasonCode=eventType):Promise<ResearchSourceLead>{
 const client=await pool.connect();try{await client.query("begin");
 const row=(await client.query<LeadRow>(`select l.* from research_source_leads l join candidate_memberships cm on cm.id=l.candidate_membership_id where l.lead_id=$1 and l.candidate_membership_id=$2 and l.captured_membership_version=$3 and cm.actor_type=$4 and cm.actor_id=$5 and cm.version=l.captured_membership_version for update of l`,[current.leadId,current.membershipId,current.membershipVersion,actor.actorType,actor.actorId])).rows[0];
 if(!row)throw new TypeError("source lead no longer belongs to actor/version");
 const effectiveId=documentId??row.document_id,effectiveHash=hash??row.document_pdf_sha256;
 const latest=(await client.query<{reason_code:string|null;event_type:string}>(`select reason_code,event_type from research_source_lead_events where lead_id=$1 order by event_sequence desc limit 1`,[current.leadId])).rows[0];
 const reasonChanged=reason!==null&&reasonCode!==(latest?.reason_code??latest?.event_type);
 const changed=row.status!==status||row.document_id!==effectiveId||row.document_pdf_sha256!==effectiveHash||reasonChanged;
 if(changed&&row.status!==status&&!transitions[row.status].includes(status))throw new TypeError("invalid source lead transition "+row.status+" -> "+status);
 const ownedTrusted=effectiveId&&["IMPORTED","DUPLICATE"].includes(status)?(await client.query<{id:string}>(`select d.id from research_documents d where d.id=$1 and d.source_lead_id=$2 and coalesce((select e.review_state from research_document_review_events e where e.document_id=d.id order by e.event_sequence desc limit 1),d.review_state)='TRUSTED'`,[effectiveId,current.leadId])).rows[0]:null;
 const pending=["DOCUMENT_VERSION_CHANGED","SOURCE_CONTENT_REGRESSION"].includes(eventType)?effectiveId:["IMPORTED","DUPLICATE"].includes(status)?null:row.pending_review_document_id;
 const updated=(await client.query<LeadRow>(`update research_source_leads set status=$2,document_id=$3,document_pdf_sha256=$4,latest_observed_document_id=coalesce($3,latest_observed_document_id),latest_observed_pdf_sha256=coalesce($4,latest_observed_pdf_sha256),active_trusted_document_id=case when $8::boolean then $3 else active_trusted_document_id end,active_trusted_pdf_sha256=case when $8::boolean then $4 else active_trusted_pdf_sha256 end,pending_review_document_id=$9,review_reason=case when $7::boolean then $5 else review_reason end,last_checked_at=$6,status_changed_at=case when $7::boolean then $6 else status_changed_at end where lead_id=$1 returning *`,[current.leadId,status,effectiveId,effectiveHash,reason,now,changed,!!ownedTrusted,pending])).rows[0];
 if(changed)await appendEvent(client,current.leadId,row.status,status,effectiveId,effectiveHash,reason,now,actor,eventType,row.document_id,row.document_pdf_sha256,reasonCode);
 await client.query("commit");return leadV2(updated);
 }catch(error){await client.query("rollback");throw error;}finally{client.release();}
}
export async function recordLeadFetch(pool:Pool,leadId:string,actor:AuthenticatedResearchActor,now:Date,failureCode:string|null):Promise<void>{
 const client=await pool.connect();try{await client.query("begin");
 const row=(await client.query<{consecutive_fetch_failures:number}>(`select l.consecutive_fetch_failures from research_source_leads l join candidate_memberships cm on cm.id=l.candidate_membership_id where l.lead_id=$1 and cm.actor_type=$2 and cm.actor_id=$3 and cm.version=l.captured_membership_version for update of l`,[leadId,actor.actorType,actor.actorId])).rows[0];
 if(!row)throw new TypeError("source lead no longer belongs to actor/version");
 const failures=failureCode?Math.min(Number(row.consecutive_fetch_failures)+1,7):0;
 const retry=failureCode?new Date(now.getTime()+Math.min(7*86400000,86400000*2**(failures-1))):null;
 await client.query(`update research_source_leads set last_fetch_attempt_at=$2,last_fetch_success_at=case when $3::text is null then $2 else last_fetch_success_at end,last_fetch_failure_code=$3,consecutive_fetch_failures=$4,next_retry_at=$5 where lead_id=$1`,[leadId,now,failureCode,failures,retry]);
 await client.query("commit");
 }catch(error){await client.query("rollback");throw error;}finally{client.release();}
}
interface EventRow {event_sequence:string;event_id:string;lead_id:string;from_status:ResearchSourceLeadStatus|null;to_status:ResearchSourceLeadStatus;event_type:string;document_id:string|null;pdf_sha256:string|null;previous_document_id:string|null;previous_pdf_sha256:string|null;reason:string|null;reason_code:string|null;reason_snapshot:string|null;observed_at:Date|string;actor_type:string;actor_id:string}
function sourceEvent(e:EventRow):ResearchSourceLeadEvent{return {sequence:Number(e.event_sequence),eventId:e.event_id,leadId:e.lead_id,fromStatus:e.from_status,toStatus:e.to_status,eventType:e.event_type,documentId:e.document_id?String(e.document_id):null,pdfSha256:e.pdf_sha256,previousDocumentId:e.previous_document_id?String(e.previous_document_id):null,previousPdfSha256:e.previous_pdf_sha256,reasonCode:e.reason_code??e.event_type,reasonSnapshot:e.reason_snapshot??e.reason,reason:e.reason_snapshot??e.reason,observedAt:iso(e.observed_at),actor:e.actor_type+":"+e.actor_id};}
export async function listSourceLeadEvents(pool:Pool,membershipId:string,actor:AuthenticatedResearchActor,limit=50):Promise<ResearchSourceLeadEvent[]>{
 const rows=await pool.query<EventRow>(`select e.* from research_source_lead_events e join research_source_leads l on l.lead_id=e.lead_id join candidate_memberships cm on cm.id=l.candidate_membership_id where cm.id=$1 and cm.actor_type=$2 and cm.actor_id=$3 and cm.version=l.captured_membership_version order by e.event_sequence desc limit $4`,[membershipId,actor.actorType,actor.actorId,Math.min(100,Math.max(1,limit))]);
 return rows.rows.reverse().map(sourceEvent);
}
export async function listLeadEventHistory(pool:Pool,membershipId:string,leadId:string,actor:AuthenticatedResearchActor,beforeSequence?:number,limit=50):Promise<{events:ResearchSourceLeadEvent[];nextBeforeSequence:number|null}>{
 const rows=await pool.query<EventRow>(`select e.* from research_source_lead_events e join research_source_leads l on l.lead_id=e.lead_id join candidate_memberships cm on cm.id=l.candidate_membership_id where cm.id=$1 and cm.actor_type=$2 and cm.actor_id=$3 and cm.version=l.captured_membership_version and l.lead_id=$4 and ($5::bigint is null or e.event_sequence<$5) order by e.event_sequence desc limit $6`,[membershipId,actor.actorType,actor.actorId,leadId,beforeSequence??null,Math.min(100,Math.max(1,limit))]);
 const events=rows.rows.map(sourceEvent);return {events,nextBeforeSequence:events.length===Math.min(100,Math.max(1,limit))?events.at(-1)!.sequence:null};
}
export async function listLeadVersions(pool:Pool,leadId:string,actor:AuthenticatedResearchActor){const rows=await pool.query<{id:string;pdf_sha256:string;page_count:number;review_state:"TRUSTED"|"NEEDS_REVIEW"|"REJECTED";imported_at:Date|string;text_fingerprint:string}>(`select d.id,d.pdf_sha256,d.page_count,coalesce(re.review_state,d.review_state) review_state,d.imported_at,coalesce(md5(string_agg(p.text_sha256,',' order by p.page_number)),'') text_fingerprint from research_documents d join research_source_leads l on l.lead_id=d.source_lead_id join candidate_memberships cm on cm.id=d.candidate_membership_id left join research_document_pages p on p.document_id=d.id left join lateral (select review_state from research_document_review_events where document_id=d.id order by event_sequence desc limit 1) re on true where l.lead_id=$1 and cm.actor_type=$2 and cm.actor_id=$3 and cm.version=d.captured_membership_version group by d.id,re.review_state order by d.imported_at desc,d.id desc`,[leadId,actor.actorType,actor.actorId]);return rows.rows.map(r=>({documentId:String(r.id),pdfSha256:r.pdf_sha256,pageCount:Number(r.page_count),reviewState:r.review_state,importedAt:iso(r.imported_at),textFingerprint:r.text_fingerprint}));}
export async function reviewLeadDocumentVersion(pool:Pool,membershipId:string,leadId:string,documentId:string,actor:AuthenticatedResearchActor,accept:boolean,reason:string,now=new Date()){
 if(actor.actorType!=="user"||reason.trim().length<3)throw new ResearchDocumentError(422,"DOCUMENT_REVIEW_REASON_REQUIRED","explicit document version review and reason required");
 const client=await pool.connect();try{await client.query("begin");
 const row=(await client.query<LeadRow>(`select l.* from research_source_leads l join candidate_memberships cm on cm.id=l.candidate_membership_id where l.lead_id=$1 and l.pending_review_document_id=$2 and l.candidate_membership_id=$3 and cm.actor_type=$4 and cm.actor_id=$5 and cm.version=l.captured_membership_version for update of l`,[leadId,documentId,membershipId,actor.actorType,actor.actorId])).rows[0];
 if(!row||row.status!=="NEEDS_REVIEW")throw new ResearchDocumentError(409,"DOCUMENT_REVIEW_DRIFT","document version is not pending review for this membership");
 const doc=(await client.query<{pdf_sha256:string;review_state:string}>(`select d.pdf_sha256,coalesce((select review_state from research_document_review_events where document_id=d.id order by event_sequence desc limit 1),d.review_state) review_state from research_documents d where d.id=$1 and d.source_lead_id=$2 and d.candidate_membership_id=$3 and d.captured_membership_version=$4 for update`,[documentId,leadId,row.candidate_membership_id,row.captured_membership_version])).rows[0];
 if(!doc||doc.review_state!=="NEEDS_REVIEW"||doc.pdf_sha256!==row.latest_observed_pdf_sha256)throw new ResearchDocumentError(409,"DOCUMENT_REVIEW_DRIFT","document version changed; reload");
 const status:ResearchSourceLeadStatus=accept||row.active_trusted_document_id?"IMPORTED":"REJECTED";
 await client.query(`insert into research_document_review_events(event_id,document_id,source_lead_id,review_state,reason,observed_at,actor_type,actor_id) values($1,$2,$3,$4,$5,$6,$7,$8)`,[randomUUID(),documentId,leadId,accept?"TRUSTED":"REJECTED",reason,now,actor.actorType,actor.actorId]);
 await client.query(`update research_source_leads set status=$2,review_reason=$3,status_changed_at=$4,pending_review_document_id=null,active_trusted_document_id=case when $5::boolean then $6 else active_trusted_document_id end,active_trusted_pdf_sha256=case when $5::boolean then $7 else active_trusted_pdf_sha256 end where lead_id=$1`,[leadId,status,reason,now,accept,documentId,doc.pdf_sha256]);
 await appendEvent(client,leadId,row.status,status,documentId,doc.pdf_sha256,reason,now,actor,accept?"DOCUMENT_VERSION_ACCEPTED":"DOCUMENT_VERSION_REJECTED",row.active_trusted_document_id?String(row.active_trusted_document_id):null,row.active_trusted_pdf_sha256);
 await client.query("commit");return {leadId,documentId,status,reviewState:accept?"TRUSTED":"REJECTED",activeTrustedDocumentId:accept?documentId:row.active_trusted_document_id?String(row.active_trusted_document_id):null,factConfirmed:false};
 }catch(error){await client.query("rollback");throw error;}finally{client.release();}
}
export function projectLeadCandidateImpact(lead:ResearchSourceLead,candidates:StructuredFactCandidate[],questions:ResearchQuestion[],reasoning:ResearchOperatingReasoning|null){
 const eligibleDocuments=[lead.activeTrustedDocumentId===undefined?lead.documentId:lead.activeTrustedDocumentId,lead.pendingReviewDocumentId];
 const related=candidates.filter(c=>c.membershipId===lead.membershipId&&c.membershipVersion===lead.membershipVersion&&c.symbol===lead.symbol&&eligibleDocuments.includes(c.documentId));
 const satisfies=(r:NonNullable<ResearchQuestion["requirement"]>)=>related.some(c=>!requirementMismatch(candidateFactIdentity(c),c.comparability??"not_comparable",r))||!!derivedEvidenceGraph(r,reasoning?.facts??[],related)?.complete;
 const questionIds=questions.filter(q=>q.requirement&&satisfies(q.requirement)).map(q=>q.questionId);
 const tests=reasoning?.model.thesisTests?.filter(t=>t.status==="ACTIVE")??[];
 const thesisTestIds:string[]=[],partialThesisTestIds:string[]=[],missingDependenciesByTest:Record<string,string[]>={};
 for(const test of tests){let full=false,partial=false;for(const r of Object.values(test.evidenceRequirements??{})){if(satisfies(r))full=true;else {const graph=derivedEvidenceGraph(r,reasoning?.facts??[],related);if(graph?.candidateIds.length){partial=true;missingDependenciesByTest[test.testId]=graph.missingDependencies;}}}if(full)thesisTestIds.push(test.testId);else if(partial)partialThesisTestIds.push(test.testId);}
 return {...proposedLeadImpact(lead,related.map(c=>c.metric),questions.filter(q=>questionIds.includes(q.questionId)).map(q=>q.targetMetric),tests.filter(t=>thesisTestIds.includes(t.testId)).flatMap(t=>t.metrics)),questionIds,thesisTestIds,partialThesisTestIds,missingDependenciesByTest,candidateIds:related.map(c=>c.id)};
}
