import { materialInvalidationNotice } from "./researchMaterialChangeEvents.js";
import { readResearchFundamentals } from "./researchFundamentalRepository.js";
import { researchFundamentalCurrentlyUsable } from "../../../../packages/contracts/src/researchFundamentals.js";
import { operatingModelFingerprint } from "../../../../packages/contracts/src/researchOperatingModel.js";
import type { Pool } from "pg";
import type { AuthenticatedResearchActor } from "./domain.js";
import type { TodayActionInboxItem } from "../../../../packages/contracts/src/todayActionInbox.js";
import { readDeepResearchWorkspace } from "./deepResearchReadRepository.js";
import {readSourceIntake} from "./researchSourceIntake.js";
import type {SourceSnapshotStoreOptions} from "./researchSourceSnapshotRepository.js";
export async function readTodayOperatingUpdate(pool:Pool,membershipId:string,actor:AuthenticatedResearchActor,now:Date,sourceStore?:SourceSnapshotStoreOptions):Promise<TodayActionInboxItem|null> {
  const w=await readDeepResearchWorkspace(pool,membershipId,actor,now,{accountScopeId:null,currentPortfolioEnabled:false,currentPortfolioMaxAgeSeconds:300,sourceStore});
  const v=w.data?.operatingReasoning,n=v?.researchUpdate??await materialInvalidationNotice(pool,actor,w,sourceStore);
  const source=await readTodaySourceIntakeUpdate(pool,membershipId,actor,now,sourceStore);
  if(source&&(!n||source.source.effectiveAt!>(n.effectiveAt??v?.fact.source.publishedAt??"")))return source;
  if(!n)return readWeeklyReviewTrigger(pool,membershipId,actor,now,sourceStore);
  return {id:`inbox:event:research:${n.membershipId}:${n.id}`,order:0,kind:"research",priority:"action",state:"new",symbol:n.symbol,
    membership:{id:n.membershipId,version:n.membershipVersion,symbol:n.symbol},
    source:{lane:"research",id:n.id,version:n.membershipVersion,status:"available",sourceType:"research_decision_update",effectiveAt:n.effectiveAt??v?.fact.source.publishedAt??null,asOf:n.effectiveAt??v?.fact.source.cutoffAt??null,fetchedAt:now.toISOString(),validUntil:v?.fact.source.validUntil??null,freshness:"fresh",sourceFingerprint:n.reasoningFingerprint},
    title:`${n.symbol} · ${n.title}`,summary:`${n.summary} 下一研究：${n.nextQuestion}`,versionChange:null,
    researchTarget:{itemId:n.id,preferredLayer:"evidence",report:null,task:null},reviewEvent:null};
}

async function readWeeklyReviewTrigger(pool:Pool,membershipId:string,actor:AuthenticatedResearchActor,now:Date,sourceStore?:SourceSnapshotStoreOptions):Promise<TodayActionInboxItem|null> {
  const f=await readResearchFundamentals(pool,membershipId,actor,now,undefined,sourceStore);
  const weekly=f.values.filter(v=>researchFundamentalCurrentlyUsable(v)&&v.membershipVersionAtWrite===f.membershipVersion&&v.assertion?.measurementBasis==="weekly_registration"&&v.assertion.category==="actual"&&v.provenance.verificationStatus==="source_text_verified");
  if(!weekly.length)return null;
  const fingerprint=operatingModelFingerprint({symbol:f.symbol,version:f.membershipVersion,facts:weekly.map(v=>({id:v.id,revision:v.revision,source:v.source}))});
  return {id:`inbox:event:research:${membershipId}:${fingerprint}`,order:0,kind:"research",priority:"medium",state:"new",symbol:f.symbol,membership:{id:membershipId,version:f.membershipVersion,symbol:f.symbol},
    source:{lane:"research",id:fingerprint,version:f.membershipVersion,status:"available",sourceType:"weekly_research_review",effectiveAt:null,asOf:f.asOf?`${f.asOf}T00:00:00.000Z`:null,fetchedAt:now.toISOString(),validUntil:weekly[0]!.source.validUntil,freshness:"fresh",sourceFingerprint:fingerprint},
    title:`${f.symbol} · 高频数据待复核`,summary:"周注册量仅为异常发现证据；核查口径和持续性，不自动修改 Thesis 或估值。",versionChange:null,researchTarget:{itemId:fingerprint,preferredLayer:"evidence",report:null,task:null},reviewEvent:null};
}

async function readTodaySourceIntakeUpdate(pool:Pool,membershipId:string,actor:AuthenticatedResearchActor,now:Date,sourceStore?:SourceSnapshotStoreOptions):Promise<TodayActionInboxItem|null>{
 const intake=await readSourceIntake(pool,membershipId,actor,now,sourceStore),item=intake.inbox.items.find(i=>i.actionability==="REQUIRED"||i.actionability==="REVIEW_WHEN_RELEVANT");
 if(!item)return null;
 const lead=intake.leads.find(l=>l.leadId===item.leadId);
 const confirmed=item.documentId?(await readResearchFundamentals(pool,membershipId,actor,now,undefined,sourceStore)).values.filter(v=>v.source.documentId===item.documentId&&["current","historical_source_stale"].includes(v.valueState)):[];
 const effectiveAt=[item.effectiveAt,...confirmed.map(v=>v.createdAt)].sort().at(-1)!;
 const fingerprint=operatingModelFingerprint({itemId:item.id,confirmedFactIds:confirmed.map(v=>v.id)});
 const title=item.type==="VERSION_REVIEW_REQUIRED"?"文档版本待核对":item.type==="EVIDENCE_INVALIDATED"?"既有研究证据已失效":item.type==="QUESTION_EVIDENCE_READY"?"研究问题有候选证据":item.type==="THESIS_TEST_EVIDENCE_READY"?"Thesis 检验有候选证据":item.type==="CONFLICTING_ASSERTIONS"?"同一事实存在冲突披露":item.type==="POSSIBLE_CORRECTION"?"已有事实可能修订":item.type==="NEW_FINANCIAL_DISCLOSURE"?"新财务资料已导入":item.type==="NEW_OPERATING_DISCLOSURE"?"新经营资料已导入":item.type==="LEAD_ONLY"?"新官方资料线索":item.type==="DUPLICATE_RESOLVED"?"官方资料已关联":"资料更新";
 const summary=(lead?.publisher??"官方来源")+"："+item.title+"。"+item.summary;
 return {id:"inbox:event:research:"+membershipId+":"+fingerprint,order:0,kind:"research",priority:item.actionability==="REQUIRED"?"action":"medium",state:"new",symbol:intake.symbol??"",
  membership:{id:membershipId,version:intake.membershipVersion,symbol:intake.symbol??""},
  source:{lane:"research",id:fingerprint,version:intake.membershipVersion,status:"available",sourceType:"research_source_intake",effectiveAt,asOf:effectiveAt,fetchedAt:now.toISOString(),validUntil:null,freshness:"fresh",sourceFingerprint:fingerprint},
  title:(intake.symbol??"")+" · "+title,summary,versionChange:null,researchTarget:{itemId:fingerprint,preferredLayer:"evidence",report:null,task:null},reviewEvent:null};
}
