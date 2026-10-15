import {createHash} from "node:crypto";
import type {Pool} from "pg";
import type {OfficialAnnouncementProvider,NoticeLeadProvider} from "../market/discovery.js";
import type {AuthenticatedResearchActor} from "./domain.js";
import {ResearchDocumentError} from "./domain.js";
import {readDeepResearchWorkspace} from "./deepResearchReadRepository.js";
import {listSourceLeads,listSourceLeadHistory,listSourceLeadEvents,listLeadVersions,upsertSourceLead,setLeadStatus,recordLeadFetch,projectLeadCandidateImpact,type SourceLeadProposal} from "./researchSourceIntakeRepository.js";
import {findDocumentByHash,type ResearchDocumentRepositoryOptions} from "./researchDocumentRepository.js";
import {importResearchDocument} from "./researchDocumentWriteRepository.js";
import {readDocumentFactCandidates} from "./researchFactCandidateRepository.js";
import {readResearchQuestions} from "./researchQuestionRepository.js";
import {buildResearchInbox,type InboxEvidenceInvalidation} from "./researchInbox.js";
import {readResearchContextSnapshot} from "./researchContextRepository.js";
import {readResearchFundamentals} from "./researchFundamentalRepository.js";
import type {SourceSnapshotStoreOptions} from "./researchSourceSnapshotRepository.js";
import {fundamentalOperatingFact} from "./researchOperatingReasoning.js";
import {factIdentity,requirementMismatch} from "../../../../packages/contracts/src/researchFactIdentity.js";
import type {EvidenceSeries} from "../../../../packages/contracts/src/researchEvidenceSeries.js";
import type {OperatingFact,OperatingResearchModel} from "../../../../packages/contracts/src/researchOperatingModel.js";
import type {ResearchOperatingReasoning} from "../../../../packages/contracts/src/researchOperatingReasoning.js";
import {canonicalSourceUrl,publicationDate,supportedOfficialUrl,type ResearchSourceLead} from "../../../../packages/contracts/src/researchSourceIntake.js";
import {nextOfficialMonitorCheckAt,researchMonitorRuleErrors,scheduledOfficialMonitorRule,type ResearchMonitorRule} from "../../../../packages/contracts/src/researchMonitorRule.js";
export interface SourceIntakeOptions {announcementProvider?:OfficialAnnouncementProvider;noticeLeadProvider?:NoticeLeadProvider;fetchImpl?:typeof fetch;document:ResearchDocumentRepositoryOptions;maxBytes:number;now?:()=>Date;maxNewDocumentImports?:number;maxVersionRechecks?:number;maxNetworkAttempts?:number;autoRefreshMinIntervalMs?:number}
export const SOURCE_REFRESH_DEFAULTS={maxNewDocumentImports:2,maxVersionRechecks:2,maxNetworkAttempts:6,autoRefreshMinIntervalMs:6*60*60*1000,maxFailureBackoffMs:24*60*60*1000} as const;
function proposalDate(p:SourceLeadProposal):string{try{return publicationDate(p.publicationDate??p.publishedAt??"");}catch{return "";}}
/** With a bounded import window, a new company needs report bodies before routine returns. */
export function prioritizeSourceProposals(proposals:SourceLeadProposal[],existingLeads:ResearchSourceLead[]){
 return proposals.map((proposal,index)=>({proposal,index,known:existingLeads.some(lead=>{
  try{return lead.canonicalUrl===canonicalSourceUrl(proposal.url)&&lead.publicationDate===proposalDate(proposal)&&lead.documentKind===proposal.documentKind;}catch{return false;}
 })})).sort((a,b)=>Number(a.known)-Number(b.known)
  ||Number(a.proposal.sourceType==="futu_notice")-Number(b.proposal.sourceType==="futu_notice")
  ||Number(b.proposal.documentKind==="financial_results")-Number(a.proposal.documentKind==="financial_results")
  ||proposalDate(b.proposal).localeCompare(proposalDate(a.proposal))
  ||Number(b.proposal.sourceType==="hkex_official")-Number(a.proposal.sourceType==="hkex_official")||a.index-b.index);
}
async function refreshState(pool:Pool,id:string,version:number){const row=(await pool.query<{last_attempt_at:Date|null;last_success_at:Date|null;last_failure_at:Date|null;failure_class:string|null;consecutive_failures:number;last_discovery_success_at:Date|null;discovery_failure_class:string|null}>(`select * from research_source_refresh_state where candidate_membership_id=$1 and captured_membership_version=$2`,[id,version])).rows[0];return {lastAttemptAt:row?.last_attempt_at?.toISOString()??null,lastSuccessAt:row?.last_success_at?.toISOString()??null,lastFailureAt:row?.last_failure_at?.toISOString()??null,lastDiscoverySuccessAt:row?.last_discovery_success_at?.toISOString()??null,discoveryFailureClass:row?.discovery_failure_class??null,failureClass:row?.failure_class??null,consecutiveFailures:row?.consecutive_failures??0};}
type RefreshState = Awaited<ReturnType<typeof refreshState>>;
type MonitorCategory = "announcement" | "financial_report" | "corporate_action";
type MonitorRuleStatus = {variableName:string;category:ResearchMonitorRule["category"];cadence:ResearchMonitorRule["cadence"];mode:"scheduled"|"manual_only"|"inactive";nextCheckAt:string|null};
type SourceMonitoringStatus = {mode:"active"|"manual_only"|"paused"|"unavailable";nextCheckAt:string|null;rules:MonitorRuleStatus[];issue:string|null};

/** The current actor and tracked membership select rules. Source text never selects a network origin. */
async function sourceMonitoringStatus(pool:Pool,id:string,actor:AuthenticatedResearchActor,version:number,state:RefreshState,now:Date,minInterval=SOURCE_REFRESH_DEFAULTS.autoRefreshMinIntervalMs):Promise<SourceMonitoringStatus>{
 const row=(await pool.query<{version:number;state:string;key_variables:string[]|null;monitor_rules:ResearchMonitorRule[]|null}>(
  `select cm.version,cm.state,rp.key_variables,rp.monitor_rules from candidate_memberships cm
   left join research_profiles rp on rp.market=cm.market and rp.code=cm.code
   where cm.id=$1 and cm.actor_type=$2 and cm.actor_id=$3 limit 1`,[id,actor.actorType,actor.actorId])).rows[0];
 if(!row)return {mode:"unavailable",nextCheckAt:null,rules:[],issue:"研究成员身份不可用"};
 if(row.version!==version)return {mode:"unavailable",nextCheckAt:null,rules:[],issue:"研究成员版本已变化"};
 if(row.state!=="tracked")return {mode:"paused",nextCheckAt:null,rules:[],issue:"研究成员已暂停或归档"};
 const rules=row.monitor_rules??[];
 if(researchMonitorRuleErrors(rules,row.key_variables??[]).length)return {mode:"unavailable",nextCheckAt:null,rules:[],issue:"当前正式监控规则未通过核对"};
 const backoff=state.lastAttemptAt?new Date(Date.parse(state.lastAttemptAt)+Math.min(
  SOURCE_REFRESH_DEFAULTS.maxFailureBackoffMs,minInterval*Math.max(1,2**Math.max(0,state.consecutiveFailures-1)))).toISOString():null;
 const summaries=rules.map((rule):MonitorRuleStatus=>{
  const scheduled=scheduledOfficialMonitorRule(rule);
  const cadenceAt=scheduled?nextOfficialMonitorCheckAt(rule,state.lastAttemptAt):null;
  return {variableName:rule.variableName,category:rule.category,cadence:rule.cadence,
   mode:!rule.enabled||rule.version===undefined||rule.confirmedAt===undefined?"inactive":scheduled?"scheduled":"manual_only",
   nextCheckAt:cadenceAt&&backoff&&backoff>cadenceAt?backoff:cadenceAt};
 });
 const upcoming=summaries.flatMap(rule=>rule.nextCheckAt?[rule.nextCheckAt]:[]).sort()[0]??null;
 const overdue=upcoming===null?0:now.getTime()-Date.parse(upcoming);
 return {mode:upcoming?"active":"manual_only",nextCheckAt:upcoming,rules:summaries,
  issue:overdue>2*60*60*1000?"计划时间已过，但尚无确认的检查记录；请核对本地服务或手动检查官方资料"
   :overdue>=0&&upcoming?"已到检查时间，等待本地服务执行":upcoming?null:"没有已确认且受支持的自动官方来源规则"};
}

function dueOfficialCategories(monitoring:SourceMonitoringStatus,now:Date):Set<MonitorCategory>{
 return new Set(monitoring.rules.filter(rule=>rule.mode==="scheduled"&&rule.nextCheckAt!==null
  &&Date.parse(rule.nextCheckAt)<=now.getTime()).map(rule=>rule.category as MonitorCategory));
}

function scheduledProposalMatches(proposal:SourceLeadProposal,categories:ReadonlySet<MonitorCategory>):boolean{
 if(categories.has("announcement"))return proposal.sourceType==="hkex_official"||proposal.sourceType==="issuer_ir";
 if(proposal.sourceType==="hkex_official")return proposal.providerCategory==="financial_report"&&categories.has("financial_report")
  ||proposal.providerCategory==="corporate_action"&&categories.has("corporate_action");
 if(proposal.sourceType!=="issuer_ir")return false;
 return proposal.documentKind==="financial_results"&&categories.has("financial_report")
  ||categories.has("corporate_action")&&/dividend|repurchase|buyback|share capital|股息|回购/i.test(proposal.title);
}
async function saveRefreshState(pool:Pool,id:string,version:number,now:Date,discoverySuccess:boolean,failureClass:string|null){await pool.query(`insert into research_source_refresh_state(candidate_membership_id,captured_membership_version,last_attempt_at,last_success_at,last_failure_at,failure_class,consecutive_failures,last_discovery_success_at,discovery_failure_class) values($1,$2,$3,$4,$5,$6,$7,$4,$6) on conflict(candidate_membership_id,captured_membership_version) do update set last_attempt_at=$3,last_success_at=coalesce($4,research_source_refresh_state.last_success_at),last_discovery_success_at=coalesce($4,research_source_refresh_state.last_discovery_success_at),last_failure_at=coalesce($5,research_source_refresh_state.last_failure_at),failure_class=$6,discovery_failure_class=$6,consecutive_failures=case when $4::timestamptz is not null then 0 else least(research_source_refresh_state.consecutive_failures+1,4) end`,[id,version,now,discoverySuccess?now:null,discoverySuccess?null:now,failureClass,discoverySuccess?0:1]);}
async function readSourceEvidenceInvalidations(pool:Pool,id:string,actor:AuthenticatedResearchActor):Promise<InboxEvidenceInvalidation[]>{
 const rows=await pool.query<{fact_id:string;document_id:string;lead_id:string;status:"RETRACTED"|"INVALID";effective_at:Date|string}>(`select distinct on (fv.id) fv.id fact_id,d.id document_id,l.lead_id,e.status,e.created_at effective_at
 from research_fundamental_assertion_lifecycle e
 join research_fundamental_values fv on fv.id=e.fundamental_value_id and fv.candidate_membership_id=e.candidate_membership_id and fv.captured_membership_version=e.captured_membership_version
 join research_materials rm on rm.id=fv.source_material_id
 join research_documents d on d.id=rm.citation_document_id and d.candidate_membership_id=fv.candidate_membership_id and d.captured_membership_version=fv.captured_membership_version
 join research_source_leads l on l.lead_id=d.source_lead_id and l.candidate_membership_id=fv.candidate_membership_id and l.captured_membership_version=fv.captured_membership_version
 join candidate_memberships cm on cm.id=fv.candidate_membership_id and cm.version=fv.captured_membership_version
 where cm.id=$1 and cm.actor_type=$2 and cm.actor_id=$3 and e.status in ('RETRACTED','INVALID')
 order by fv.id,e.created_at desc,e.id desc`,[id,actor.actorType,actor.actorId]);
 return rows.rows.map(row=>({factId:String(row.fact_id),documentId:String(row.document_id),leadId:row.lead_id,status:row.status,effectiveAt:new Date(row.effective_at).toISOString()}));
}
export async function readSourceIntake(pool:Pool,id:string,actor:AuthenticatedResearchActor,now=new Date(),sourceStore?:SourceSnapshotStoreOptions){
 const leads=await listSourceLeads(pool,id,actor),w=await readDeepResearchWorkspace(pool,id,actor,now,{accountScopeId:null,currentPortfolioEnabled:false,currentPortfolioMaxAgeSeconds:300,sourceStore}),questions=await readResearchQuestions(pool,id,actor,now),candidates=await readDocumentFactCandidates(pool,id,actor,w.data?.operatingReasoning?.facts??[],now);
 const projected=await Promise.all(leads.map(async l=>{const versions=await listLeadVersions(pool,l.leadId,actor),current=versions.find(v=>v.documentId===l.latestObservedDocumentId),hasCandidates=candidates.candidates.some(c=>c.documentId===l.activeTrustedDocumentId||c.documentId===l.pendingReviewDocumentId);return {...l,versions,documentReviewState:current?.reviewState??null,extractionStatus:!l.latestObservedDocumentId?"NOT_IMPORTED":hasCandidates?"CANDIDATES_AVAILABLE":current&&current.pageCount<=24?"NO_SUPPORTED_TEMPLATE_OR_ROWS":"NOT_SCANNED_OR_LIMITED",impact:projectLeadCandidateImpact(l,candidates.candidates,questions.questions,w.data?.operatingReasoning??null)};}));
 const rank=(lead:typeof projected[number])=>lead.status==="NEEDS_REVIEW"?0:lead.impact.thesisTestIds.length?1:lead.impact.questionIds.length?2:lead.documentKind==="financial_results"?3:lead.documentKind==="monthly_sales"?4:lead.status==="DISCOVERED"?6:5;
 projected.sort((a,b)=>rank(a)-rank(b)||b.statusChangedAt.localeCompare(a.statusChangedAt));
 const [events,rawInvalidations,historyPage]=await Promise.all([listSourceLeadEvents(pool,id,actor),readSourceEvidenceInvalidations(pool,id,actor),listSourceLeadHistory(pool,id,actor)]);
 const invalidations=rawInvalidations.length?await currentEvidenceInvalidations(pool,id,actor,w,questions.questions,rawInvalidations,now,sourceStore):[];
 const allInbox=buildResearchInbox({symbol:w.requestedSymbol??"",membershipId:id,membershipVersion:w.data?.target.membershipVersion??0},projected,candidates.candidates,events,invalidations);
 const visible=new Set([...historyPage.leads.map(l=>l.leadId),...allInbox.items.filter(i=>i.actionability==="REQUIRED"||i.actionability==="REVIEW_WHEN_RELEVANT").map(i=>i.leadId)]);
 const inbox={...allInbox,items:allInbox.items.filter(i=>visible.has(i.leadId))};
 const version=w.data?.target.membershipVersion??0,state=version?await refreshState(pool,id,version):null;
 const monitoring=state?await sourceMonitoringStatus(pool,id,actor,version,state,now).catch(()=>(
  {mode:"unavailable" as const,nextCheckAt:null,rules:[],issue:"监控规则状态暂不可读取"}))
  :{mode:"unavailable" as const,nextCheckAt:null,rules:[],issue:"研究成员版本不可用"};
 return {status:"available",symbol:w.requestedSymbol,membershipId:id,membershipVersion:version,leads:projected.filter(l=>visible.has(l.leadId)),historyPage,events,inbox,refreshState:state,monitoring,pendingReviewCount:inbox.requiredCount,lastSuccessfulRefresh:state?.lastDiscoverySuccessAt??state?.lastSuccessAt??null,metrics:{leadsDiscovered:leads.length,documentsImported:leads.filter(l=>l.status==="IMPORTED").length,duplicates:leads.filter(l=>l.status==="DUPLICATE").length,candidatesProposed:candidates.candidates.length,questionsImpacted:new Set(projected.flatMap(l=>l.impact.questionIds)).size,unsupportedTemplates:projected.filter(l=>l.status==="IMPORTED"&&l.extractionStatus==="NO_SUPPORTED_TEMPLATE_OR_ROWS").length}};
}
export function currentEvidenceSeriesReferencesFact(series:EvidenceSeries[]|undefined,factId:string):boolean {
 return !!series?.some(s=>[s.current,s.previous].some(o=>!!o&&(o.assertionIds.includes(factId)||o.historicalAssertionIds.includes(factId)||o.inputs.includes(factId))));
}
export function currentEvidenceInvalidationRelevant(row:InboxEvidenceInvalidation,direct:ReadonlySet<string>,questions:Awaited<ReturnType<typeof readResearchQuestions>>["questions"],reasoning:ResearchOperatingReasoning|null|undefined,fact:OperatingFact|null,model:OperatingResearchModel|undefined):boolean {
 if(direct.has(row.factId)||questions.some(q=>q.evidenceIds.includes(row.factId))||currentEvidenceSeriesReferencesFact(reasoning?.evidenceSeries,row.factId))return true;
 if(!fact||fact.comparability!=="comparable")return false;
 const identity=factIdentity(fact),replacement=reasoning?.facts.some(f=>f.id!==fact.id&&factIdentity(f).metric===identity.metric&&f.period.end===fact.period.end&&f.businessScope===fact.businessScope&&f.measurementBasis===fact.measurementBasis);
 if(replacement)return false;
 if(questions.some(q=>q.requirement&&requirementMismatch(identity,"comparable",q.requirement)===null))return true;
 if(model?.thesisTests?.some(t=>t.status==="ACTIVE"&&Object.values(t.evidenceRequirements??{}).some(requirement=>requirementMismatch(identity,"comparable",requirement)===null)))return true;
 return !!reasoning?.profitBridge&&[reasoning.profitBridge.period.end,reasoning.profitBridge.previousPeriod.end].includes(fact.period.end)&&reasoning.profitBridge.rows.some(r=>r.metric===fact.metric);
}
async function currentEvidenceInvalidations(pool:Pool,id:string,actor:AuthenticatedResearchActor,w:Awaited<ReturnType<typeof readDeepResearchWorkspace>>,questions:Awaited<ReturnType<typeof readResearchQuestions>>["questions"],rows:InboxEvidenceInvalidation[],now:Date,sourceStore?:SourceSnapshotStoreOptions):Promise<InboxEvidenceInvalidation[]>{
 const [context,fundamentals,versions]=await Promise.all([readResearchContextSnapshot(pool,id,actor,now),readResearchFundamentals(pool,id,actor,now,undefined,sourceStore),pool.query<{model_payload:import("../../../../packages/contracts/src/researchOperatingModel.js").OperatingResearchModel;assumptions_payload:Array<{basedOnFactIds:string[]}>}>(`select distinct on (scenario_period_type) model_payload,assumptions_payload from research_underwriting_scenario_versions where candidate_membership_id=$1 and actor_type=$2 and actor_id=$3 and captured_membership_version=(select version from candidate_memberships where id=$1 and actor_type=$2 and actor_id=$3) order by scenario_period_type,created_at desc,id desc`,[id,actor.actorType,actor.actorId])]);
 const model=context.data?.operatingModel,reasoning=w.data?.operatingReasoning;
 const direct=new Set([model?.sharesValueId,...(model?.thesisRevision?.evidenceFactIds??[]),...(model?.thesisOwnerAction?.triggeringFactIds??[]),...(model?.scenarios??[]).flatMap(s=>Object.values(s.inputs).flatMap(input=>[input.sourceValueId,...(input.rationale?.basedOnFactIds??[])])),...versions.rows.flatMap(v=>[v.model_payload.sharesValueId,...v.assumptions_payload.flatMap(a=>a.basedOnFactIds)]),...(reasoning?.thesisUpdate?.tests??[]).flatMap(t=>t.observations.flatMap(o=>o.evidenceIds)),...(reasoning?.sharesReference?.inputs??[]),...(reasoning?.profitBridge?.rows??[]).flatMap(r=>[...r.current.inputs,...r.previous.inputs])].filter((v):v is string=>!!v));
 return rows.filter(row=>{const value=fundamentals.values.find(f=>f.id===row.factId),fact=value?fundamentalOperatingFact(value,w,true):null;return currentEvidenceInvalidationRelevant(row,direct,questions,reasoning,fact,model);});
}
/** Bounded official discovery; duplicate/version checks never consume the new-document budget. */
export async function refreshSourceIntake(pool:Pool,id:string,actor:AuthenticatedResearchActor,options:SourceIntakeOptions,manual?:SourceLeadProposal,force=false,scheduled=false){
 if(actor.actorType!=="user")throw new ResearchDocumentError(422,"USER_ACTOR_REQUIRED","source refresh requires user-scoped authorization");
 if(scheduled&&(manual!==undefined||force))throw new ResearchDocumentError(422,"INVALID_SOURCE_REFRESH","scheduled refresh cannot carry a manual source or force flag");
 const started=Date.now(),now=options.now?.()??new Date();
 const sourceStore=()=>({repositoryRoot:options.document.repositoryRoot,rawStoreRoot:options.document.rawStoreRoot,availabilityCache:new Map()});
 const w=await readDeepResearchWorkspace(pool,id,actor,now,{accountScopeId:null,currentPortfolioEnabled:false,currentPortfolioMaxAgeSeconds:300,sourceStore:sourceStore()}),symbol=w.requestedSymbol;if(!symbol||w.data?.target.membershipState!=="tracked")throw new ResearchDocumentError(409,"MEMBERSHIP_UNAVAILABLE","tracked issuer membership is required");
 const version=w.data.target.membershipVersion,state=await refreshState(pool,id,version),minInterval=options.autoRefreshMinIntervalMs??SOURCE_REFRESH_DEFAULTS.autoRefreshMinIntervalMs;
 const monitoring=scheduled?await sourceMonitoringStatus(pool,id,actor,version,state,now,minInterval):null;
 const dueCategories=monitoring?dueOfficialCategories(monitoring,now):null;
 if(scheduled&&(!dueCategories||dueCategories.size===0))return {...await readSourceIntake(pool,id,actor,now,sourceStore()),refresh:{skipped:monitoring?.mode==="unavailable"?"RULES_UNAVAILABLE":"NO_DUE_RULE",nextEligibleAt:monitoring?.nextCheckAt??null,durationMs:0,discovered:0,imported:0,duplicates:0,failed:0}};
 const cooldown=Math.min(SOURCE_REFRESH_DEFAULTS.maxFailureBackoffMs,minInterval*Math.max(1,2**Math.max(0,state.consecutiveFailures-1)));
 if(!manual&&!force&&state.lastAttemptAt&&now.getTime()-Date.parse(state.lastAttemptAt)<cooldown)return {...await readSourceIntake(pool,id,actor,now,sourceStore()),refresh:{skipped:"COOLDOWN",nextEligibleAt:new Date(Date.parse(state.lastAttemptAt)+cooldown).toISOString(),durationMs:0,discovered:0,imported:0,duplicates:0,failed:0}};
 const discovery=manual?{proposals:[manual],discoverySuccess:true,providerStatus:"manual"}:await discoverSourceLeads(w,symbol,options,dueCategories);
 const {proposals,discoverySuccess,providerStatus}=discovery;
 let imported=0,duplicates=0,failed=0,networkAttempts=0,versionRechecks=0;const seen=new Set<string>(),existingLeads=await listSourceLeads(pool,id,actor);
 const ordered=prioritizeSourceProposals(proposals,existingLeads);
 const scheduledStillEligible=async(proposal:SourceLeadProposal):Promise<boolean>=>{
  if(!scheduled)return true;
  const latest=await refreshState(pool,id,version);
  const current=await sourceMonitoringStatus(pool,id,actor,version,latest,options.now?.()??new Date(),minInterval);
  return scheduledProposalMatches(proposal,dueOfficialCategories(current,options.now?.()??new Date()));
 };
 for(const {proposal,known} of ordered){
  if(!(await scheduledStillEligible(proposal)))continue;
  let url:string;try{url=canonicalSourceUrl(proposal.url);}catch{failed++;continue;}
  const date=proposalDate(proposal);if(!date){failed++;continue;}const key=url+date+proposal.documentKind;if(seen.has(key))continue;seen.add(key);
  let lead=await upsertSourceLead(pool,id,actor,{...proposal,url},now);
  if(!supportedOfficialUrl(url,symbol)||proposal.sourceType==="futu_notice")continue;
  if(known&&!force&&!manual&&lead.nextRetryAt&&Date.parse(lead.nextRetryAt)>now.getTime())continue;
  if(known){if(versionRechecks>=(options.maxVersionRechecks??SOURCE_REFRESH_DEFAULTS.maxVersionRechecks))continue;versionRechecks++;}
  else if(imported>=(options.maxNewDocumentImports??SOURCE_REFRESH_DEFAULTS.maxNewDocumentImports))continue;
  if(networkAttempts>=(options.maxNetworkAttempts??SOURCE_REFRESH_DEFAULTS.maxNetworkAttempts))break;
  if(!(await manualHkexEligible(pool,lead,actor,options,proposal,url,symbol,now))){failed++;continue;}
  if(!(await scheduledStillEligible(proposal)))continue;
  if(lead.status==="DISCOVERED")lead=await setLeadStatus(pool,lead,actor,"SUPPORTED",null,null,null,now);
  networkAttempts++;const result=await captureOfficialLead(pool,lead,actor,options,now,()=>scheduledStillEligible(proposal));if(result==="imported")imported++;else if(result==="duplicate")duplicates++;else if(result!=="skipped")failed++;
 }
 await saveRefreshState(pool,id,version,now,discoverySuccess,discoverySuccess?null:"PROVIDER_UNAVAILABLE");
 const current=await readSourceIntake(pool,id,actor,now,sourceStore());return {...current,refresh:{providerStatus,discoverySuccess,durationMs:Date.now()-started,discovered:seen.size,imported,duplicates,failed,networkAttempts,versionRechecks,limits:{maxNewDocumentImports:options.maxNewDocumentImports??SOURCE_REFRESH_DEFAULTS.maxNewDocumentImports,maxVersionRechecks:options.maxVersionRechecks??SOURCE_REFRESH_DEFAULTS.maxVersionRechecks,maxNetworkAttempts:options.maxNetworkAttempts??SOURCE_REFRESH_DEFAULTS.maxNetworkAttempts}}};
}
async function manualHkexEligible(pool:Pool,lead:ResearchSourceLead,actor:AuthenticatedResearchActor,options:SourceIntakeOptions,proposal:SourceLeadProposal,url:string,symbol:string,now:Date):Promise<boolean>{
 if(proposal.sourceType!=="owner_url"||!new URL(url).hostname.includes("hkexnews.hk"))return true;
 const official=await options.announcementProvider?.read(symbol,proposalDate(proposal)).catch(()=>null);
 const matched=official?.status==="available"&&official.items.some(item=>{try{return canonicalSourceUrl(item.documentUrl)===url;}catch{return false;}});
 if(matched)return true;
 await setLeadStatus(pool,lead,actor,"NEEDS_REVIEW",null,null,"HKEX URL was not independently matched to this issuer",now,"SOURCE_IDENTITY_REVIEW");return false;
}
async function discoverSourceLeads(workspace:Awaited<ReturnType<typeof readDeepResearchWorkspace>>,symbol:string,options:SourceIntakeOptions,scheduledCategories:ReadonlySet<MonitorCategory>|null=null):Promise<{proposals:SourceLeadProposal[];discoverySuccess:boolean;providerStatus:string}>{
 const proposals:SourceLeadProposal[]=[];
 for(const material of (workspace.data?.materials??[]).filter(m=>m.revisionState==="current"&&(!scheduledCategories||m.verificationStatus==="verified")&&m.sourceUrl&&supportedOfficialUrl(m.sourceUrl,symbol)).slice(0,4))proposals.push({sourceType:"issuer_ir",publisher:symbol==="HK.00175"?"Geely Auto official IR":"Issuer public source",title:material.title,publishedAt:material.publishedAt??undefined,url:material.sourceUrl!,documentKind:/sales|销量/i.test(material.title)?"monthly_sales":/result|interim|annual|业绩/i.test(material.title)?"financial_results":"announcement",origin:"existing_research_material"});
 const [official,notice]=await Promise.allSettled([options.announcementProvider?.read(symbol),scheduledCategories?undefined:options.noticeLeadProvider?.read(symbol)]);
 const officialSuccess=official.status==="fulfilled"&&official.value?.status==="available",noticeSuccess=notice.status==="fulfilled"&&notice.value?.status==="available";
 if(official.status==="fulfilled"&&official.value?.status==="available"){
  const returned:SourceLeadProposal[]=official.value.items.map(item=>({sourceType:"hkex_official",publisher:"HKEXnews",title:item.title,publishedAt:`${item.publishedDate}T00:00:00.000Z`,url:item.documentUrl,documentKind:item.category==="financial_report"?"financial_results":"announcement",providerCategory:item.category,origin:"hkexnews_title_search"}));
  proposals.push(...(scheduledCategories?returned.filter(proposal=>scheduledProposalMatches(proposal,scheduledCategories)).slice(0,8):returned.slice(0,8)));
 }
 if(!scheduledCategories&&notice.status==="fulfilled"&&notice.value?.status==="available")for(const item of notice.value.items.slice(0,4))proposals.push({sourceType:"futu_notice",publisher:item.source,title:item.title,publishedAt:item.publishedAt,url:item.url,documentKind:"announcement",providerCategory:item.kind,origin:"futu_opend_notice"});
 const selected=scheduledCategories?proposals.filter(proposal=>scheduledProposalMatches(proposal,scheduledCategories)):proposals;
 const discoverySuccess=scheduledCategories?officialSuccess
  :officialSuccess||noticeSuccess||(!options.announcementProvider&&!options.noticeLeadProvider);
 return {proposals:selected,discoverySuccess,providerStatus:officialSuccess?"available":selected.length?"local_only":"unavailable"};
}
export async function captureOfficialLead(pool:Pool,lead:ResearchSourceLead,actor:AuthenticatedResearchActor,options:SourceIntakeOptions,now=new Date(),stillEligible?:()=>Promise<boolean>):Promise<"imported"|"duplicate"|"needs_review"|"skipped">{
 if(!supportedOfficialUrl(lead.canonicalUrl,lead.symbol))return "needs_review";
 let bytes:Buffer;
 try{bytes=await fetchOfficialPdf(lead.canonicalUrl,lead.symbol,options.fetchImpl??fetch,options.maxBytes);}catch(error){if(stillEligible&&!(await stillEligible()))return "skipped";const code=error instanceof ResearchDocumentError?error.code:"SOURCE_FETCH_FAILED";await recordLeadFetch(pool,lead.leadId,actor,now,code);await setLeadStatus(pool,lead,actor,"NEEDS_REVIEW",lead.latestObservedDocumentId,lead.latestObservedPdfSha256,String(error).slice(0,300),now,"SOURCE_FETCH_FAILED",code);return "needs_review";}
 if(stillEligible&&!(await stillEligible()))return "skipped";
 await recordLeadFetch(pool,lead.leadId,actor,now,null);
 const hash=createHash("sha256").update(bytes).digest("hex"),existing=await findDocumentByHash(pool,lead.membershipId,hash,actor,lead.leadId);
 if(existing){
  if(lead.latestObservedPdfSha256&&lead.latestObservedPdfSha256!==hash){
   if(lead.activeTrustedDocumentId===String(existing.id)&&!lead.pendingReviewDocumentId){await setLeadStatus(pool,lead,actor,"IMPORTED",String(existing.id),hash,null,now,"ACTIVE_VERSION_RETURNED");return "duplicate";}
   await pool.query(`insert into research_document_review_events(event_id,document_id,source_lead_id,review_state,reason,observed_at,actor_type,actor_id) select gen_random_uuid(),id,source_lead_id,'NEEDS_REVIEW','SOURCE_CONTENT_REGRESSION',$3,$4,$5 from research_documents where id=$1 and source_lead_id=$2`,[existing.id,lead.leadId,now,actor.actorType,actor.actorId]);
   await setLeadStatus(pool,lead,actor,"NEEDS_REVIEW",String(existing.id),hash,"SOURCE_CONTENT_REGRESSION: previously captured bytes returned after a newer version",now,"SOURCE_CONTENT_REGRESSION");return "needs_review";
  }
  if(lead.latestObservedDocumentId!==String(existing.id)||lead.latestObservedPdfSha256!==hash)await setLeadStatus(pool,lead,actor,"DUPLICATE",String(existing.id),hash,null,now);
  return "duplicate";
 }
 const changed=lead.latestObservedPdfSha256!==null&&lead.latestObservedPdfSha256!==hash;
 const u=new URL(lead.canonicalUrl),filename=u.pathname.split("/").at(-1)??"official.pdf";
 if(stillEligible&&!(await stillEligible()))return "skipped";
 try{
  const imported=await importResearchDocument(pool,lead.membershipId,{membershipVersion:lead.membershipVersion,title:lead.title,publishedAt:lead.publishedAt,sourceVersion:`official:${hash.slice(0,24)}`,rightsConfirmed:true,idempotencyKey:`intake-document-${lead.leadId}-${hash}`},filename,bytes,actor,options.document,now,{capturedSourceUrl:lead.canonicalUrl,publisher:lead.publisher,documentKind:lead.documentKind,sourceLeadId:lead.leadId,reviewState:changed?"NEEDS_REVIEW":"TRUSTED"});
  await setLeadStatus(pool,lead,actor,changed?"NEEDS_REVIEW":"IMPORTED",imported.data.document.id,hash,changed?"DOCUMENT_CONTENT_CHANGED: same captured URL returned different PDF bytes; old document remains immutable":null,now,changed?"DOCUMENT_VERSION_CHANGED":"DOCUMENT_IMPORTED");return "imported";
 }catch(error){await setLeadStatus(pool,lead,actor,"NEEDS_REVIEW",lead.documentId,lead.documentPdfSha256,`DOCUMENT_IMPORT_REVIEW: ${error instanceof Error?error.message:String(error)}`.slice(0,300),now,"DOCUMENT_IMPORT_REVIEW");return "needs_review";}
}
export async function fetchOfficialPdf(url:string,symbol:string,fetchImpl:typeof fetch,maxBytes:number):Promise<Buffer>{
 if(!supportedOfficialUrl(url,symbol))throw new ResearchDocumentError(422,"UNSUPPORTED_SOURCE","official PDF origin is not supported");
 const initialOrigin=new URL(url).origin;let current=url,res:Response;
 for(let redirects=0;;redirects++){
  res=await fetchImpl(current,{headers:{accept:"application/pdf", "accept-language":"en-US,en;q=0.9", "user-agent":"InvestmentAssistantResearch/1.0 (+official PDF research)"},redirect:"manual",cache:"no-store",signal:AbortSignal.timeout(12_000)});
  if(res.status<300||res.status>=400)break;
  const location=res.headers.get("location");if(redirects>=2||!location)throw new ResearchDocumentError(422,"REDIRECT_REVIEW","official PDF redirect chain needs review");
  let next:string;try{next=canonicalSourceUrl(new URL(location,current).toString());}catch{throw new ResearchDocumentError(422,"REDIRECT_REVIEW","invalid official PDF redirect");}
  if(!supportedOfficialUrl(next,symbol)||new URL(next).origin!==initialOrigin)throw new ResearchDocumentError(422,"REDIRECT_REVIEW","PDF redirected outside the approved official publisher origin");
  current=next;
 }
 if(!res.ok||!res.headers.get("content-type")?.toLowerCase().startsWith("application/pdf"))throw new ResearchDocumentError(415,"PDF_CONTENT_TYPE","source did not return application/pdf");
 const length=Number(res.headers.get("content-length")??0);if(length>maxBytes)throw new ResearchDocumentError(413,"PDF_TOO_LARGE","official PDF exceeds configured import limit");
 if(!res.body)throw new ResearchDocumentError(422,"PDF_EMPTY","PDF response is empty");
 const reader=res.body.getReader(),chunks:Uint8Array[]=[];let size=0;try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maxBytes)throw new ResearchDocumentError(413,"PDF_TOO_LARGE","official PDF exceeds configured import limit");chunks.push(part.value);}}finally{reader.releaseLock();}
 const bytes=Buffer.concat(chunks);if(!bytes.subarray(0,5).equals(Buffer.from("%PDF-")))throw new ResearchDocumentError(415,"PDF_MAGIC","source body is not a PDF");return bytes;
}
