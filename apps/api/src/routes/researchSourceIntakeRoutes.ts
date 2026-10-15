import type {FastifyInstance} from "fastify";
import type {Pool} from "pg";
import type {ResearchAuthOptions} from "./researchAuth.js";
import {authenticateReadOnly,authenticateWrite} from "./researchAuth.js";
import type {OfficialAnnouncementProvider,NoticeLeadProvider} from "../market/discovery.js";
import type {ResearchDocumentRuntimeOptions} from "./researchDocumentRoutes.js";
import {readSourceIntake,refreshSourceIntake} from "../research/researchSourceIntake.js";
import type {SourceLeadProposal} from "../research/researchSourceIntakeRepository.js";
import {ResearchDocumentError} from "../research/domain.js";
import {reviewLeadDocumentVersion,listLeadEventHistory,listSourceLeadHistory} from "../research/researchSourceIntakeRepository.js";
import {publicationDate} from "../../../../packages/contracts/src/researchSourceIntake.js";
interface Options extends ResearchAuthOptions {pool:Pool;announcementProvider?:OfficialAnnouncementProvider;noticeLeadProvider?:NoticeLeadProvider;researchDocument?:ResearchDocumentRuntimeOptions;sourceIntakeFetchImpl?:typeof fetch;now?:()=>Date}
function documentOptions(o:Options){if(!o.researchDocument?.repositoryRoot)throw new ResearchDocumentError(503,"RAW_STORE_INVALID","document store unavailable");return {repositoryRoot:o.researchDocument.repositoryRoot,rawStoreRoot:o.researchDocument.rawStoreRoot,maxBytes:o.researchDocument.maxBytes??20*1024*1024,maxPages:o.researchDocument.maxPages??400,maxPageTextCharacters:o.researchDocument.maxPageTextCharacters??200000,maxTotalTextCharacters:o.researchDocument.maxTotalTextCharacters??5000000,executablePath:o.researchDocument.ocrExecutablePath??null,maxOcrPages:o.researchDocument.maxOcrPages??100,maxOcrPageTextCharacters:o.researchDocument.maxOcrPageTextCharacters??200000,ocrTimeoutMs:o.researchDocument.ocrTimeoutMs??120000,ocrMaxBufferBytes:o.researchDocument.ocrMaxBufferBytes??64*1024*1024};}
function membership(id:string){return /^[1-9][0-9]*$/.test(id);}
function fail(reply:import("fastify").FastifyReply,error:unknown){if(error instanceof ResearchDocumentError)return reply.code(error.statusCode).send({ok:false,code:error.code,message:error.message});return reply.code(503).send({ok:false,code:"SOURCE_INTAKE_UNAVAILABLE",message:error instanceof Error?error.message:String(error)});}
export async function registerResearchSourceIntakeRoutes(app:FastifyInstance,o:Options):Promise<void>{
 const path="/api/mobile/research/candidate-memberships/:id/source-intake";
 app.get(path,async(request,reply)=>{const actor=authenticateReadOnly(request.headers,o),id=(request.params as {id:string}).id;if(!actor)return reply.code(401).send({ok:false,message:"read authorization required"});if(!membership(id))return reply.code(400).send({ok:false,message:"invalid membership"});try{return await readSourceIntake(o.pool,id,actor,o.now?.(),
  o.researchDocument?{repositoryRoot:o.researchDocument.repositoryRoot,rawStoreRoot:o.researchDocument.rawStoreRoot,availabilityCache:new Map()}:undefined);}catch(e){return fail(reply,e);}});
 app.get(path+"/leads",async(request,reply)=>{
  const actor=authenticateReadOnly(request.headers,o),id=(request.params as {id:string}).id;
  if(!actor)return reply.code(401).send({ok:false,message:"read authorization required"});
  if(!membership(id))return reply.code(400).send({ok:false,message:"invalid membership"});
  const query=request.query as {beforeLeadId?:string;limit?:string},limit=query.limit===undefined?50:Number(query.limit);
  if(query.beforeLeadId!==undefined&&!/^[a-f0-9]{64}$/.test(query.beforeLeadId)||!Number.isSafeInteger(limit)||limit<1||limit>100)return reply.code(400).send({ok:false,code:"INVALID_LEAD_CURSOR"});
  try{return await listSourceLeadHistory(o.pool,id,actor,query.beforeLeadId,limit);}catch(error){return fail(reply,error);}
 });
 app.get(path+"/leads/:leadId/events",async(request,reply)=>{
  const actor=authenticateReadOnly(request.headers,o),{id,leadId}=request.params as {id:string;leadId:string};
  if(!actor)return reply.code(401).send({ok:false,message:"read authorization required"});
  if(!membership(id)||!(/^[a-f0-9]{64}$/.test(leadId)))return reply.code(400).send({ok:false,code:"INVALID_SOURCE_LEAD"});
  const query=request.query as {beforeSequence?:string;limit?:string},before=query.beforeSequence===undefined?undefined:Number(query.beforeSequence),limit=query.limit===undefined?50:Number(query.limit);
  if(before!==undefined&&(!Number.isSafeInteger(before)||before<1)||!Number.isSafeInteger(limit)||limit<1||limit>100)return reply.code(400).send({ok:false,code:"INVALID_EVENT_CURSOR"});
  try{return await listLeadEventHistory(o.pool,id,leadId,actor,before,limit);}catch(e){return fail(reply,e);}
 });
 app.post(path+"/refresh",async(request,reply)=>{const actor=authenticateWrite(request.headers,o,"research_write"),id=(request.params as {id:string}).id;if(!actor||actor.actorType!=="user")return reply.code(401).send({ok:false,message:"explicit user write authorization required"});if(!membership(id))return reply.code(400).send({ok:false,message:"invalid membership"});
  const body=request.body as Record<string,unknown>|undefined;let manual:SourceLeadProposal|undefined;
  if(body?.manualRefresh===true&&Object.keys(body).length!==1)return reply.code(422).send({ok:false,code:"INVALID_SOURCE_REFRESH"});
  if(body?.scheduledRefresh===true&&Object.keys(body).length!==1)return reply.code(422).send({ok:false,code:"INVALID_SOURCE_REFRESH"});
  if(body&&Object.keys(body).length&&body.manualRefresh!==true&&body.scheduledRefresh!==true){
   const keys=Object.keys(body).sort().join(),newKeys=["url","title","publicationDate","documentKind"].sort().join(),legacyKeys=["url","title","publishedAt","documentKind"].sort().join();
   if(![newKeys,legacyKeys].includes(keys)||typeof body.url!=="string"||typeof body.title!=="string"||typeof (body.publicationDate??body.publishedAt)!=="string"||!(["monthly_sales","financial_results","announcement","other"] as unknown[]).includes(body.documentKind))return reply.code(422).send({ok:false,code:"INVALID_SOURCE_LEAD"});
   let date:string;try{date=publicationDate(String(body.publicationDate??body.publishedAt));}catch{return reply.code(422).send({ok:false,code:"INVALID_SOURCE_DATE"});}
   let hostname:string;try{hostname=new URL(body.url).hostname;}catch{return reply.code(422).send({ok:false,code:"INVALID_SOURCE_LEAD",message:"source URL is invalid"});}
   manual={url:body.url,title:body.title,publicationDate:date,documentKind:body.documentKind as SourceLeadProposal["documentKind"],sourceType:"owner_url",publisher:hostname==="www.geelyauto.com.hk"?"Geely Auto official IR":"Official URL supplied by Owner",origin:"owner_manual_url"};
  }
  try{return await refreshSourceIntake(o.pool,id,actor,{announcementProvider:o.announcementProvider,noticeLeadProvider:o.noticeLeadProvider,document:documentOptions(o),fetchImpl:o.sourceIntakeFetchImpl,maxBytes:o.researchDocument?.maxBytes??20*1024*1024,now:o.now},manual,body?.manualRefresh===true,body?.scheduledRefresh===true);}catch(e){return fail(reply,e);}
 });
 app.post(path+"/leads/:leadId/versions/:documentId/review",async(request,reply)=>{
  const actor=authenticateWrite(request.headers,o,"research_write"),id=(request.params as {id:string}).id,leadId=(request.params as {leadId:string}).leadId,documentId=(request.params as {documentId:string}).documentId;
  if(!actor||actor.actorType!=="user")return reply.code(401).send({ok:false,message:"explicit user research write authorization required"});
  if(!membership(id)||!membership(documentId)||!(/^[a-f0-9]{64}$/.test(leadId)))return reply.code(400).send({ok:false,code:"INVALID_DOCUMENT_REVIEW"});
  const body=request.body as {action?:string;reason?:string}|undefined;
  if(!body||!(["accept","reject"].includes(body.action??""))||typeof body.reason!=="string"||body.reason.trim().length<3||body.reason.length>500)return reply.code(422).send({ok:false,code:"INVALID_DOCUMENT_REVIEW"});
  try{return await reviewLeadDocumentVersion(o.pool,id,leadId,documentId,actor,body.action==="accept",body.reason,o.now?.());}catch(e){return fail(reply,e);}
 });
}
