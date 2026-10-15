import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { canonicalJson } from "../../../../packages/contracts/src/decisionContextBrowser.js";
import { RESEARCH_FINANCIAL_REQUIREMENT_SCHEMA_VERSION, validateCreateResearchFinancialRequirementRequest,
  type CreateResearchFinancialRequirementRequest, type ResearchFinancialRequirementData,
  type ResearchFinancialRequirementEnvelope, type ResearchFinancialRequirementSource,
  type ResearchFinancialRequirementSourceInput } from "../../../../packages/contracts/src/researchFinancialRequirement.js";
import { RESEARCH_WRITE_SCHEMA_VERSION, type ResearchWriteEnvelope } from "../../../../packages/contracts/src/research.js";
import { readCandidateMembershipById } from "./candidateMembershipPersistence.js";
import { assertCandidateMembershipWriteBinding } from "./researchWriteBinding.js";
import { readResearchRawBytes } from "./researchDocumentCas.js";
import type { SourceSnapshotStoreOptions } from "./researchSourceSnapshotRepository.js";
import { CandidateMembershipNotFoundError, IdempotencyConflictError, type AuthenticatedResearchActor } from "./domain.js";

type Query = Pick<Pool | PoolClient,"query">;
type Row = { id:string; candidate_membership_id:string; membership_version:number; actor_type:"user"; actor_id:string; symbol:string;
 version:number; fiscal_year_end:string; latest_required_annual_period_end:Date|string; latest_required_interim_period_start:Date|string;
 latest_required_interim_period_end:Date|string; as_of:Date|string; next_review_at:Date|string; valid_until:Date|string;
 sources:ResearchFinancialRequirementSource[]; owner_confirmed:true; request_fingerprint:string; created_at:Date|string };
type MaterialRow = { id:string; revision:number; content_fingerprint:string; source_version:string; source_type:ResearchFinancialRequirementSource["sourceType"];
 valid_until:Date|string; deleted_at:Date|string|null; superseded:boolean; snapshot_pending_review:boolean;
 citation_document_id:string|null; citation_page_number:number|null; citation_page_text_sha256:string|null;
 citation_snapshot_id:string|null; citation_snapshot_text_sha256:string|null; citation_start_utf16:number|null;
 citation_end_utf16:number|null; citation_excerpt_sha256:string|null;
 original_sha256:string|null; original_byte_length:number|null; pdf_page_text:string|null; snapshot_text:string|null; document_source_lead_id:string|null;
 active_trusted_document_id:string|null; pending_review_document_id:string|null; document_review_state:string|null };
export class ResearchFinancialRequirementError extends Error {
  constructor(readonly statusCode:400|403|409|422|503,readonly code:string,message:string){super(message);this.name="ResearchFinancialRequirementError";}
}
const iso=(value:Date|string)=>new Date(value).toISOString();
// PostgreSQL DATE is parsed as local midnight; UTC formatting can shift its calendar day.
export const postgresCalendarDay=(value:Date|string)=>typeof value==="string"?value.slice(0,10)
  : `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,"0")}-${String(value.getDate()).padStart(2,"0")}`;
const fingerprint=(actor:AuthenticatedResearchActor,membershipId:string,request:CreateResearchFinancialRequirementRequest)=>
  createHash("sha256").update(canonicalJson({actor,membershipId,request})).digest("hex");
const rowData=(row:Row):ResearchFinancialRequirementData=>({ schemaVersion:RESEARCH_FINANCIAL_REQUIREMENT_SCHEMA_VERSION,id:String(row.id),
 version:Number(row.version),membershipId:String(row.candidate_membership_id),membershipVersion:Number(row.membership_version),symbol:row.symbol,
 actorType:"user",actorId:row.actor_id,fiscalYearEnd:row.fiscal_year_end,
 latestRequiredAnnualPeriodEnd:postgresCalendarDay(row.latest_required_annual_period_end),
 latestRequiredInterimPeriodStart:postgresCalendarDay(row.latest_required_interim_period_start),latestRequiredInterimPeriodEnd:postgresCalendarDay(row.latest_required_interim_period_end),
 asOf:iso(row.as_of),nextReviewAt:iso(row.next_review_at),validUntil:iso(row.valid_until),sources:row.sources,
 ownerConfirmed:true,createdAt:iso(row.created_at) });
async function latest(client:Query,membershipId:string,actorId:string):Promise<Row|null>{
 const r=await client.query<Row>(`select * from research_financial_requirements where candidate_membership_id=$1 and actor_type='user' and actor_id=$2 order by version desc limit 1`,[membershipId,actorId]);return r.rows[0]??null;
}
async function material(client:Query,membershipId:string,actorId:string,source:ResearchFinancialRequirementSourceInput):Promise<MaterialRow|null>{
 const r=await client.query<MaterialRow>(`select rm.id,rm.revision,rm.content_fingerprint,rm.source_version,ei.source_type,rm.valid_until,rm.deleted_at,
 exists(select 1 from research_materials child where child.replaces_material_id=rm.id) superseded,
 case when s.id is null then false else exists(select 1 from research_source_snapshots newer where newer.candidate_membership_id=s.candidate_membership_id and newer.canonical_url=s.canonical_url and (newer.captured_at,newer.id)>(s.captured_at,s.id) and newer.text_sha256<>s.text_sha256) end snapshot_pending_review,
 rm.citation_document_id,rm.citation_page_number,rm.citation_page_text_sha256,rm.citation_snapshot_id,
 rm.citation_snapshot_text_sha256,rm.citation_start_utf16,rm.citation_end_utf16,rm.citation_excerpt_sha256,
 coalesce(rd.pdf_sha256,s.raw_sha256) original_sha256,coalesce(rd.byte_length,s.byte_length) original_byte_length,
 p.normalized_text pdf_page_text,s.normalized_text snapshot_text,
 rd.source_lead_id document_source_lead_id,l.active_trusted_document_id,l.pending_review_document_id,
 coalesce((select review_state from research_document_review_events where document_id=rd.id order by event_sequence desc limit 1),rd.review_state) document_review_state
 from research_materials rm join candidate_memberships cm on cm.id=rm.candidate_membership_id
 join evidence_items ei on ei.id=rm.evidence_item_id
 left join research_documents rd on rd.id=rm.citation_document_id and rd.candidate_membership_id=rm.candidate_membership_id
 left join research_document_pages p on p.document_id=rm.citation_document_id and p.page_number=rm.citation_page_number and p.text_sha256=rm.citation_page_text_sha256
 left join research_source_snapshots s on s.id=rm.citation_snapshot_id and s.candidate_membership_id=rm.candidate_membership_id and s.captured_membership_version=rm.citation_snapshot_membership_version and s.text_sha256=rm.citation_snapshot_text_sha256
 left join research_source_leads l on l.lead_id=rd.source_lead_id
 where rm.id=$1 and rm.candidate_membership_id=$2 and cm.actor_type='user' and cm.actor_id=$3
 and rm.revision=$4 and rm.content_fingerprint=$5
 and ei.source_type in ('owner_provided_pdf','issuer_public_pdf','issuer_public_html')
 and rm.claim_type in ('issuer_statement','third_party_statement','verified_fact')
 and ((ei.source_type='owner_provided_pdf' and rm.rights_status='user_provided') or (ei.source_type in ('issuer_public_pdf','issuer_public_html') and rm.rights_status='authorized_public'))
 and rm.verification_status in ('unverified','verified')
 and (rm.claim_type<>'verified_fact' or rm.verification_status='verified')
 and ((ei.source_type in ('owner_provided_pdf','issuer_public_pdf') and rd.id is not null and p.document_id is not null)
 or (ei.source_type='issuer_public_html' and s.id is not null and s.actor_type='user' and s.actor_id=$3 and s.symbol=cm.symbol and s.captured_membership_version=cm.version))`,
 [source.materialId,membershipId,actorId,source.materialRevision,source.contentFingerprint]);return r.rows[0]??null;
}
async function verifiedSource(client:Query,membershipId:string,actorId:string,source:ResearchFinancialRequirementSourceInput,now:Date,store?:SourceSnapshotStoreOptions):Promise<{data:ResearchFinancialRequirementSource;validUntil:string;citedText:string}|null>{
 const row=await material(client,membershipId,actorId,source);
 if(!row||row.deleted_at||row.superseded||row.snapshot_pending_review||Date.parse(String(row.valid_until))<=now.getTime()
   || !row.original_sha256||!row.original_byte_length||!store) return null;
 if(row.document_source_lead_id && (String(row.active_trusted_document_id)!==String(row.citation_document_id)
   || row.pending_review_document_id!==null||row.document_review_state!=="TRUSTED"))return null;
 try{await readResearchRawBytes(store.rawStoreRoot,store.repositoryRoot,row.original_sha256,Number(row.original_byte_length));}catch{return null;}
 const citation=row.citation_snapshot_id===null
  ? {documentId:String(row.citation_document_id),pageNumber:Number(row.citation_page_number),pageTextSha256:String(row.citation_page_text_sha256)}
  : {kind:"source_snapshot" as const,snapshotId:String(row.citation_snapshot_id),textSha256:String(row.citation_snapshot_text_sha256),
    startUtf16:Number(row.citation_start_utf16),endUtf16:Number(row.citation_end_utf16),excerptSha256:String(row.citation_excerpt_sha256)};
 const citedText=row.citation_snapshot_id===null?row.pdf_page_text:
   row.snapshot_text?.slice(Number(row.citation_start_utf16),Number(row.citation_end_utf16));
 if(!citedText)return null;
 return {data:{...source,sourceVersion:row.source_version,sourceType:row.source_type,citation,
   originalSha256:row.original_sha256,originalByteLength:Number(row.original_byte_length)},validUntil:iso(row.valid_until),citedText};
}
export async function readResearchFinancialRequirement(pool:Query,membershipId:string,actor:AuthenticatedResearchActor,
 now=new Date(),store?:SourceSnapshotStoreOptions):Promise<ResearchFinancialRequirementEnvelope>{
 const member=await readCandidateMembershipById(pool,actor,membershipId);
 if(!member)throw new CandidateMembershipNotFoundError();
 const row=await latest(pool,membershipId,actor.actorId);
 const base={schemaVersion:RESEARCH_FINANCIAL_REQUIREMENT_SCHEMA_VERSION as typeof RESEARCH_FINANCIAL_REQUIREMENT_SCHEMA_VERSION,membershipId,requestedActorId:actor.actorId,requestedSymbol:member.symbol,
 latestRequirementId:row?String(row.id):null};
 if(!row)return {...base,status:"not_found",data:null,gaps:["fiscal filing requirement has not been checked"]};
 const data=rowData(row),gaps:string[]=[];
 if(data.membershipVersion!==Number(member.version))gaps.push("membership version changed");
 if(Date.parse(data.validUntil)<=now.getTime())gaps.push("fiscal requirement or source review expired");
 if(Date.parse(data.asOf)>now.getTime())gaps.push("fiscal requirement as-of is in the future");
 const citedTexts:string[]=[];
 for(const source of data.sources){const current=await verifiedSource(pool,membershipId,actor.actorId,source,now,store);
   if(!current||canonicalJson(current.data)!==canonicalJson(source))gaps.push(`source material ${source.materialId} changed or original unavailable`);
   else citedTexts.push(current.citedText);}
 if(!periodCited(citedTexts,data.latestRequiredAnnualPeriodEnd))gaps.push("latest required annual period is absent from cited originals");
 if(!periodCited(citedTexts,data.latestRequiredInterimPeriodEnd))gaps.push("latest required interim period is absent from cited originals");
 return {...base,status:gaps.length?"unavailable":"available",data:gaps.length?null:data,gaps};
}
export async function createResearchFinancialRequirement(pool:Pool,membershipId:string,request:CreateResearchFinancialRequirementRequest,
 actor:AuthenticatedResearchActor,now=new Date(),store?:SourceSnapshotStoreOptions):Promise<ResearchWriteEnvelope<ResearchFinancialRequirementData>>{
 const validation=validateCreateResearchFinancialRequirementRequest(request);
 if(!validation.ok)throw new ResearchFinancialRequirementError(400,"INVALID_REQUIREMENT",validation.errors.join("; "));
 if(actor.actorType!=="user")throw new ResearchFinancialRequirementError(403,"OWNER_REQUIRED","explicit user actor required");
 if(Date.parse(request.asOf)>now.getTime()||Date.parse(request.nextReviewAt)<=now.getTime())
   throw new ResearchFinancialRequirementError(409,"INVALID_REVIEW_WINDOW","as-of must not be future and next review must be future");
 const fp=fingerprint(actor,membershipId,request),client=await pool.connect();
 try{await client.query("begin");
  const member=await assertCandidateMembershipWriteBinding(client,actor,{membershipId,membershipVersion:request.membershipVersion});
  const replay=await client.query<Row>(`select * from research_financial_requirements where actor_type='user' and actor_id=$1 and idempotency_key=$2`,[actor.actorId,request.idempotencyKey]);
  if(replay.rows[0]){if(replay.rows[0].request_fingerprint!==fp)throw new IdempotencyConflictError("financial requirement idempotency conflict");
    await client.query("commit");return envelope(rowData(replay.rows[0]),actor,"Financial requirement replayed.");}
  const previous=await latest(client,membershipId,actor.actorId);
  if((previous?.id??null)!==request.baseRequirementId)throw new ResearchFinancialRequirementError(409,"REQUIREMENT_VERSION_CONFLICT","base requirement is stale");
  const verified=[];
  for(const source of request.sourceMaterials){const current=await verifiedSource(client,membershipId,actor.actorId,source,now,store);
    if(!current)throw new ResearchFinancialRequirementError(409,"SOURCE_UNAVAILABLE",`source material ${source.materialId} is stale or its original is unavailable`);
    verified.push(current);}
  const citedTexts=verified.map(item=>item.citedText);
  if(!periodCited(citedTexts,request.latestRequiredAnnualPeriodEnd)
    || !periodCited(citedTexts,request.latestRequiredInterimPeriodEnd))
    throw new ResearchFinancialRequirementError(422,"PERIOD_NOT_CITED","selected original citations must show the declared annual and interim period ends");
  const validUntil=new Date(Math.min(Date.parse(request.nextReviewAt),...verified.map(item=>Date.parse(item.validUntil)))).toISOString();
  const result=await client.query<Row>(`insert into research_financial_requirements
   (candidate_membership_id,membership_version,actor_type,actor_id,symbol,version,base_requirement_id,fiscal_year_end,
    latest_required_annual_period_end,latest_required_interim_period_start,latest_required_interim_period_end,
    as_of,next_review_at,valid_until,sources,owner_confirmed,idempotency_key,request_fingerprint)
   values ($1,$2,'user',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,true,$15,$16) returning *`,
   [membershipId,request.membershipVersion,actor.actorId,member.symbol,Number(previous?.version??0)+1,request.baseRequirementId,
    request.fiscalYearEnd,request.latestRequiredAnnualPeriodEnd,request.latestRequiredInterimPeriodStart,
    request.latestRequiredInterimPeriodEnd,request.asOf,request.nextReviewAt,validUntil,JSON.stringify(verified.map(item=>item.data)),request.idempotencyKey,fp]);
  await client.query("commit");return envelope(rowData(result.rows[0]!),actor,"Financial requirement recorded.");
 }catch(error){await client.query("rollback");
   if((error as {code?:string}).code==="23505"){
     const winner=await client.query<Row>(`select * from research_financial_requirements where actor_type='user' and actor_id=$1 and idempotency_key=$2`,
       [actor.actorId,request.idempotencyKey]);
     if(winner.rows[0] && winner.rows[0].request_fingerprint===fp)
       return envelope(rowData(winner.rows[0]),actor,"Financial requirement replayed.");
     throw new ResearchFinancialRequirementError(409,"REQUIREMENT_CONFLICT","financial requirement version or idempotency key conflicted");
   }
   throw error;
 }finally{client.release();}
}
function envelope(data:ResearchFinancialRequirementData,actor:AuthenticatedResearchActor,message:string):ResearchWriteEnvelope<ResearchFinancialRequirementData>{
 return {schemaVersion:RESEARCH_WRITE_SCHEMA_VERSION,status:"succeeded",asOf:data.createdAt,source:{actorType:actor.actorType,actorId:actor.actorId,correlationId:null},data,message};
}

export function periodCited(texts:string[],periodEnd:string):boolean{
 const [year,month,day]=periodEnd.split('-').map(Number);
 const monthName=['january','february','march','april','may','june','july','august','september','october','november','december'][month-1];
 if(!monthName)return false;
 const months=[String(month),String(month).padStart(2,'0')],days=[String(day),String(day).padStart(2,'0')];
 const targets=[`${day} ${monthName} ${year}`,`${monthName} ${day} ${year}`,
  `${day} ${monthName.slice(0,3)} ${year}`,`${monthName.slice(0,3)} ${day} ${year}`];
 for(const m of months)for(const d of days){
  targets.push(`${year}-${m}-${d}`,`${year}/${m}/${d}`,`${year}.${m}.${d}`,`${year}年${m}月${d}日`,`${d}/${m}/${year}`);
 }
 return texts.some(text=>{const normalized=text.toLowerCase().replace(/[,\s]+/g,' ').replace(/\s+/g,' ').trim();
  const containsToken=(target:string)=>{let at=normalized.indexOf(target);
    while(at>=0){const before=normalized[at-1]??"",after=normalized[at+target.length]??"";
      if(!/[a-z0-9]/.test(before)&&!/[a-z0-9]/.test(after))return true;
      at=normalized.indexOf(target,at+1);}
    return false;};
  if(targets.some(containsToken))return true;
  const dayMonth=[`${day} ${monthName}`,`${monthName} ${day}`,`${day} ${monthName.slice(0,3)}`,
    `${monthName.slice(0,3)} ${day}`,...months.flatMap(m=>days.map(d=>`${m}月${d}日`))];
  return dayMonth.some(target=>{let at=normalized.indexOf(target);
    while(at>=0){const nearby=normalized.slice(Math.max(0,at-80),at+target.length+160);
      if(new RegExp(`(^|[^0-9])${year}($|[^0-9])`).test(nearby))return true;
      at=normalized.indexOf(target,at+1);}
    return false;});
 });
}
