import {operatingModelFingerprint} from "../../../../packages/contracts/src/researchOperatingModel.js";
import {candidateFactIdentity} from "../../../../packages/contracts/src/researchFactCandidates.js";
import {factIdentityKey,normalizedAmountKey} from "../../../../packages/contracts/src/researchFactIdentity.js";
import type {StructuredFactCandidate} from "../../../../packages/contracts/src/researchFactCandidates.js";
import type {ResearchSourceLead,ResearchSourceLeadEvent} from "../../../../packages/contracts/src/researchSourceIntake.js";
import type {ResearchInboxActionability,ResearchDocumentRelevance,ResearchInboxItem,ResearchInboxProjection,FactReviewGroup,FactReviewAction} from "../../../../packages/contracts/src/researchInbox.js";

export type InboxLead=ResearchSourceLead&{extractionStatus?:string;impact:{questionIds:string[];thesisTestIds:string[];partialThesisTestIds?:string[];candidateIds:string[]}};
export interface InboxEvidenceInvalidation {factId:string;documentId:string;leadId?:string;status:"RETRACTED"|"INVALID";effectiveAt:string}
const protectedResearch=/profit warning|results announcement|interim results|annual results|monthly sales|sales volume|share buyback|repurchase|issue of shares|share issuance|major acquisition|major disposal|connected transaction|next day disclosure|guidance|盈警|业绩|销量|回购|发行股份|关联交易|收购|出售/i;
const administrative=/notification letter|notice of publication of corporate communications|reply form to registered shareholders|non-registered shareholders|股东通讯之发布通知|致非登记股东之通知|回条/i;
export function documentRelevance(lead:InboxLead,hasCandidates:boolean,hasDirectImpact:boolean):ResearchDocumentRelevance {
 if(hasDirectImpact)return "ACTIVE_RESEARCH";
 if(lead.providerCategory==="administrative"&&!protectedResearch.test(lead.title)&&!hasCandidates)return "ADMINISTRATIVE";
 if(["financial_report","corporate_action","business_change"].includes(lead.providerCategory??""))return "GENERAL_RESEARCH";
 if(administrative.test(lead.title)&&!protectedResearch.test(lead.title)&&!hasCandidates)return "ADMINISTRATIVE";
 if(lead.documentKind==="financial_results"||lead.documentKind==="monthly_sales"||protectedResearch.test(lead.title))return "GENERAL_RESEARCH";
 if(lead.extractionStatus==="NO_SUPPORTED_TEMPLATE_OR_ROWS")return "UNSUPPORTED";
 return hasCandidates?"GENERAL_RESEARCH":"UNKNOWN";
}
function groupAction(candidates:StructuredFactCandidate[],conflict:boolean):FactReviewAction {
 if(conflict||candidates.some(c=>c.classification==="CONFLICTING_ASSERTION"))return "REVIEW_CONFLICT";
 if(candidates.some(c=>c.classification==="POSSIBLE_CORRECTION"))return "REVIEW_CORRECTION";
 if(candidates.some(c=>c.classification==="ADDITIONAL_SOURCE"||c.classification==="VERIFICATION_UPGRADE"))return "VERIFY_ADDITIONAL_SOURCE";
 if(candidates.some(c=>c.confirmationState!=="already_confirmed"))return "CONFIRM_NEW_FACT";
 return "NO_ACTION";
}
export function buildFactReviewGroups(leads:InboxLead[],candidates:StructuredFactCandidate[]):FactReviewGroup[]{
 const byIdentity=new Map<string,StructuredFactCandidate[]>();
 for(const candidate of candidates){if(candidate.confirmationAllowed!==true||!leads.some(l=>l.activeTrustedDocumentId===candidate.documentId&&l.pendingReviewDocumentId===null))continue;const key=factIdentityKey(candidateFactIdentity(candidate));byIdentity.set(key,[...(byIdentity.get(key)??[]),candidate]);}
 return [...byIdentity].map(([identity,group])=>{
  const values=new Set(group.map(c=>normalizedAmountKey(c.proposedValue,c.unitScale))),conflict=values.size>1,action=groupAction(group,conflict);
  const linked=leads.filter(l=>group.some(c=>c.documentId===l.activeTrustedDocumentId||c.documentId===l.pendingReviewDocumentId||c.documentId===l.latestObservedDocumentId));
  const related=linked.filter(l=>group.some(c=>l.impact.candidateIds.includes(c.id)));
  const first=group[0]!;
  return {id:operatingModelFingerprint({identity}),factIdentity:identity,currentFactIds:[...new Set(group.map(c=>c.existingFactId).filter((id):id is string=>!!id))],candidateIds:group.map(c=>c.id),assertionSourceCount:new Set(group.map(c=>c.documentId)).size,classification:conflict?"CONFLICTING_ASSERTIONS":group[0]!.classification??"AMBIGUOUS",activeQuestionIds:[...new Set(related.flatMap(l=>l.impact.questionIds))],activeThesisTestIds:[...new Set(related.flatMap(l=>l.impact.thesisTestIds))],recommendedAction:action,title:first.metric+" · "+first.periodEnd,leadIds:linked.map(l=>l.leadId)};
 }).sort((a,b)=>a.title.localeCompare(b.title));
}
function actionForLead(lead:InboxLead,groups:FactReviewGroup[],relevance:ResearchDocumentRelevance,event?:ResearchSourceLeadEvent,invalidations:InboxEvidenceInvalidation[]=[],previewDifference=false):{type:ResearchInboxItem["type"];actionability:ResearchInboxActionability;summary:string}{
 if(lead.pendingReviewDocumentId){
  const message=event?.reasonCode==="SOURCE_CONTENT_REGRESSION"?"官方链接再次返回较早捕获版本，需要核对是否应切换可信版本。":"同一官方链接的文档内容发生变化，需要先核对捕获版本；尚未确认任何 FACT。";
  const snapshot=event?.reasonSnapshot?.trim();
  return {type:"VERSION_REVIEW_REQUIRED",actionability:"REQUIRED",summary:message+(previewDifference?" 待审新版本中检测到不同数值；接受前不计入正式事实冲突。":"")+(snapshot?` 事件记录：${snapshot.slice(0,120)}`:"")};
 }
 if(invalidations.length)return {type:"EVIDENCE_INVALIDATED",actionability:"REQUIRED",summary:"此前依赖的来源绑定事实已撤回或标为无效，需要重新核对研究问题。"};
 if(lead.status==="DUPLICATE"&&lead.activeTrustedDocumentId===null)return {type:"DUPLICATE_RESOLVED",actionability:"RESOLVED",summary:"已关联现有官方文档，无需重复确认。"};
 const linked=groups.filter(g=>g.leadIds.includes(lead.leadId));
 if(linked.some(g=>g.recommendedAction==="REVIEW_CONFLICT"))return {type:"CONFLICTING_ASSERTIONS",actionability:"REQUIRED",summary:"同一经济事实出现不同数值，需核对原文与口径，系统不会自动选取。"};
 if(linked.some(g=>g.recommendedAction==="REVIEW_CORRECTION"))return {type:"POSSIBLE_CORRECTION",actionability:"REQUIRED",summary:"已有事实可能被修订，需核对版本与原文。"};
 if(linked.some(g=>g.activeQuestionIds.length&&g.recommendedAction!=="NO_ACTION"))return {type:"QUESTION_EVIDENCE_READY",actionability:"REQUIRED",summary:"新候选可能回答当前研究问题；确认来源和结构后才会成为 FACT。"};
 if(linked.some(g=>g.activeThesisTestIds.length&&g.recommendedAction!=="NO_ACTION"))return {type:"THESIS_TEST_EVIDENCE_READY",actionability:"REQUIRED",summary:"候选可能补齐已配置的 Thesis Test；正式判断保持不变。"};
 if(relevance==="ADMINISTRATIVE")return {type:"ADMINISTRATIVE_DISCLOSURE",actionability:"INFORMATIONAL",summary:"行政股东通讯已存档，可在全部资料中查看。"};
 if(lead.extractionStatus==="NO_SUPPORTED_TEMPLATE_OR_ROWS")return {type:"UNSUPPORTED_DOCUMENT",actionability:"INFORMATIONAL",summary:"官方文档已保存，目前无受支持的结构化提取模板；可查看原文。"};
 if(lead.status==="NEEDS_REVIEW"&&!lead.pendingReviewDocumentId){
  const diagnostic=event?.reasonSnapshot?.trim(),suffix=diagnostic?` 事件记录：${diagnostic.slice(0,120)}`:"";
  const message=event?.eventType==="SOURCE_FETCH_FAILED"?"官方资料暂时无法自动获取，系统会按来源单独重试。":event?.eventType==="SOURCE_IDENTITY_REVIEW"?"无法确认该官方 PDF 属于当前公司，需核对来源身份。":"来源状态需要核对；可查看事件记录。";
  return {type:"LEAD_ONLY",actionability:"INFORMATIONAL",summary:message+suffix};
 }
 if(lead.documentKind==="financial_results"&&linked.some(g=>g.recommendedAction!=="NO_ACTION"))return {type:"NEW_FINANCIAL_DISCLOSURE",actionability:"REVIEW_WHEN_RELEVANT",summary:"官方财务资料已导入；相同经济事实按来源合并显示。"};
 if(lead.documentKind==="monthly_sales"&&linked.some(g=>g.recommendedAction!=="NO_ACTION"))return {type:"NEW_OPERATING_DISCLOSURE",actionability:"REVIEW_WHEN_RELEVANT",summary:"月度经营资料已导入，候选需明确核对。"};
 if(linked.some(g=>g.recommendedAction!=="NO_ACTION"))return {type:"LEAD_ONLY",actionability:"REVIEW_WHEN_RELEVANT",summary:"官方资料已导入可核对候选，尚未自动成为 FACT。"};
 if(lead.status==="IMPORTED"||lead.status==="DUPLICATE")return {type:"DUPLICATE_RESOLVED",actionability:"RESOLVED",summary:"资料已保存或关联；当前没有必须处理的新研究事项。"};
 return {type:"LEAD_ONLY",actionability:"INFORMATIONAL",summary:"发现官方资料线索，尚未成为结构化 FACT。"};
}
const actionRank:Record<ResearchInboxActionability,number>={REQUIRED:0,REVIEW_WHEN_RELEVANT:1,INFORMATIONAL:2,RESOLVED:3};
const typeRank:Record<ResearchInboxItem["type"],number>={CONFLICTING_ASSERTIONS:0,EVIDENCE_INVALIDATED:1,POSSIBLE_CORRECTION:2,VERSION_REVIEW_REQUIRED:3,QUESTION_EVIDENCE_READY:4,THESIS_TEST_EVIDENCE_READY:5,NEW_FINANCIAL_DISCLOSURE:6,NEW_OPERATING_DISCLOSURE:7,UNSUPPORTED_DOCUMENT:8,ADMINISTRATIVE_DISCLOSURE:9,LEAD_ONLY:10,DUPLICATE_RESOLVED:11};
function compareItems(a:ResearchInboxItem,b:ResearchInboxItem):number {
 const action=actionRank[a.actionability]-actionRank[b.actionability];if(action)return action;
 if(a.actionability==="REQUIRED"){const type=typeRank[a.type]-typeRank[b.type];if(type)return type;}
 return b.effectiveAt.localeCompare(a.effectiveAt)||(b.eventSequence??0)-(a.eventSequence??0)||typeRank[a.type]-typeRank[b.type];
}
export function buildResearchInbox(identity:{symbol:string;membershipId:string;membershipVersion:number},leads:InboxLead[],candidates:StructuredFactCandidate[],events:ResearchSourceLeadEvent[],invalidations:InboxEvidenceInvalidation[]=[]):ResearchInboxProjection {
 const facts=buildFactReviewGroups(leads,candidates),latest=new Map<string,ResearchSourceLeadEvent>();
 for(const event of events)if(event.eventType!=="LEGACY_STATE_SNAPSHOT")latest.set(event.leadId,event);
 const items:ResearchInboxItem[]=leads.map(lead=>{
  const linked=facts.filter(g=>g.leadIds.includes(lead.leadId));
  const relevance=documentRelevance(lead,linked.length>0,lead.impact.questionIds.length>0||lead.impact.thesisTestIds.length>0);
  const preview=candidates.filter(c=>c.documentId===lead.pendingReviewDocumentId),active=candidates.filter(c=>c.documentId===lead.activeTrustedDocumentId);
  const previewDifference=preview.some(p=>active.some(a=>factIdentityKey(candidateFactIdentity(p))===factIdentityKey(candidateFactIdentity(a))&&normalizedAmountKey(p.proposedValue,p.unitScale)!==normalizedAmountKey(a.proposedValue,a.unitScale)));
  const event=latest.get(lead.leadId),affected=invalidations.filter(x=>x.leadId?x.leadId===lead.leadId:[lead.activeTrustedDocumentId,lead.latestObservedDocumentId].includes(x.documentId)),action=actionForLead(lead,facts,relevance,event,affected,previewDifference),effectiveAt=[event?.observedAt??lead.statusChangedAt,...affected.map(x=>x.effectiveAt)].sort().at(-1)!;
  return {id:operatingModelFingerprint({leadId:lead.leadId,eventId:event?.eventId??null,action:action.type,groups:linked.map(g=>g.id),invalidatedFactIds:affected.map(x=>x.factId)}),leadId:lead.leadId,type:action.type,actionability:action.actionability,relevance,title:lead.title,summary:action.summary,effectiveAt,eventId:event?.eventId??null,eventSequence:event?.sequence??null,documentId:lead.pendingReviewDocumentId??lead.activeTrustedDocumentId??lead.latestObservedDocumentId,factGroupIds:linked.map(g=>g.id),questionIds:[...new Set(linked.flatMap(g=>g.activeQuestionIds))],thesisTestIds:[...new Set(linked.flatMap(g=>g.activeThesisTestIds))]};
 });
 items.sort(compareItems);
 const assignedGroups=new Set<string>();
 for(const item of items){
  if(item.actionability!=="REQUIRED"||item.type==="VERSION_REVIEW_REQUIRED")continue;
  if(item.factGroupIds.length&&item.factGroupIds.every(id=>assignedGroups.has(id))){
   item.actionability="RESOLVED";item.type="DUPLICATE_RESOLVED";item.summary="同一经济事实已合并到另一项核对事项，无需重复处理。";
   item.id=operatingModelFingerprint({leadId:item.leadId,eventId:item.eventId,type:item.type,groups:item.factGroupIds});
  }else for(const id of item.factGroupIds)assignedGroups.add(id);
 }
 items.sort(compareItems);
 const counts={required:items.filter(i=>i.actionability==="REQUIRED").length,reviewWhenRelevant:items.filter(i=>i.actionability==="REVIEW_WHEN_RELEVANT").length,informational:items.filter(i=>i.actionability==="INFORMATIONAL").length,resolved:items.filter(i=>i.actionability==="RESOLVED").length};
 return {...identity,requiredCount:counts.required,otherCount:counts.reviewWhenRelevant+counts.informational,items,factGroups:facts,counts};
}
