import { readMaterialRevisionEvents } from "./researchMaterialChangeEvents.js";
import { historicalOperatingSnapshot } from "./researchHistoricalReasoning.js";
import type { Pool,PoolClient } from "pg";
import type { AuthenticatedResearchActor } from "./domain.js";
import type { ResearchContextEnvelope } from "../../../../packages/contracts/src/researchContext.js";
import type { ResearchFundamentalsEnvelope } from "../../../../packages/contracts/src/researchFundamentals.js";
import type { DeepResearchWorkspaceEnvelope } from "../../../../packages/contracts/src/deepResearch.js";
import { operatingModelFingerprint, type OperatingResearchModel } from "../../../../packages/contracts/src/researchOperatingModel.js";
import { buildResearchChange, type ResearchChangeEvent } from "../../../../packages/contracts/src/researchDecisionUpdate.js";
import { sameNormalizedAmount } from "../../../../packages/contracts/src/researchFactIdentity.js";
import type { ResearchOperatingReasoning } from "../../../../packages/contracts/src/researchOperatingReasoning.js";
import type {SourceSnapshotStoreOptions} from "./researchSourceSnapshotRepository.js";
/** Read-only reconstruction from existing append-only facts and contexts; no event database or GET writes. */
export async function attachResearchChange(pool:Pick<Pool|PoolClient,"query">,actor:AuthenticatedResearchActor,w:DeepResearchWorkspaceEnvelope,f:ResearchFundamentalsEnvelope,c:ResearchContextEnvelope,current:ResearchOperatingReasoning,sourceStore?:SourceSnapshotStoreOptions):Promise<void> {
  const contexts=await pool.query<{id:string;created_at:Date|string;context_payload:{operatingModel?:OperatingResearchModel}}>(`select id,created_at,context_payload from research_context_snapshots where candidate_membership_id=$1 and captured_membership_version=$2 and selected_symbol=$3 and actor_type=$4 and actor_id=$5 order by created_at,id`,[current.membershipId,current.membershipVersion,current.symbol,actor.actorType,actor.actorId]);
  const clean=contexts.rows.filter(row=>!JSON.stringify(row.context_payload.operatingModel??{}).includes("TEST FIXTURE ONLY"));
  type Event={recordedAt:string;effectiveAt:string;type:ResearchChangeEvent["triggerType"];sourceIds?:string[]};
  const reportTime=w.data?.reports.find(r=>r.id===current.model.thesisBinding?.reportId)?.createdAt;
  const events:Event[]=f.values.filter(v=>v.membershipVersionAtWrite===current.membershipVersion&&v.symbol===current.symbol&&v.assertion&&v.createdAt<=w.generatedAt).map(v=>{
    const published=v.source.publishedAt??v.createdAt,corrected=v.amendmentKind!=="initial";
    const previous=corrected?f.values.find(p=>p.id===v.replacesValueId):undefined;
    const sameAssertion=previous?.source.materialId===v.source.materialId&&previous.value!==null&&v.value!==null&&sameNormalizedAmount(previous.value,previous.unitScale,v.value,v.unitScale)&&operatingModelFingerprint({metric:previous.metric,periodStart:previous.periodStart,periodEnd:previous.periodEnd,currency:previous.currency,scope:previous.scope,unit:previous.assertion?.unit,businessScope:previous.assertion?.businessScope,measurementBasis:previous.assertion?.measurementBasis,category:previous.assertion?.category,mix:previous.assertion?.mix??null})===operatingModelFingerprint({metric:v.metric,periodStart:v.periodStart,periodEnd:v.periodEnd,currency:v.currency,scope:v.scope,unit:v.assertion?.unit,businessScope:v.assertion?.businessScope,measurementBasis:v.assertion?.measurementBasis,category:v.assertion?.category,mix:v.assertion?.mix??null});
    const old=reportTime?published<=reportTime:published.slice(0,10)<v.createdAt.slice(0,10);
    const type:Event["type"]=v.assertion?.measurementBasis==="weekly_registration"?"weekly_review":sameAssertion?"verification_upgrade":corrected?(v.assertion?.category==="guidance"?"guidance_revision":"evidence_correction"):old?"old_evidence_extracted":"new_disclosure";
    return {recordedAt:v.createdAt,effectiveAt:corrected||old?v.createdAt:published,type};
  });
  events.push(...await readMaterialRevisionEvents(pool,actor,current.membershipId,current.membershipVersion,w.generatedAt));
  for(const [index,row] of clean.entries()){
    const model=row.context_payload.operatingModel,prior=clean[index-1]?.context_payload.operatingModel,revision=model?.thesisRevision;
    const changedRevision=operatingModelFingerprint(revision??null)!==operatingModelFingerprint(prior?.thesisRevision??null);
    if(changedRevision&&revision?.status==="OWNER_CONFIRMED"&&revision.confirmedAt)events.push({recordedAt:new Date(row.created_at).toISOString(),effectiveAt:revision.confirmedAt,type:"thesis_revision"});
    else if(index>0&&operatingModelFingerprint(model??null)!==operatingModelFingerprint(prior??null))events.push({recordedAt:new Date(row.created_at).toISOString(),effectiveAt:new Date(row.created_at).toISOString(),type:"research_model_update"});
  }
  for(const guidance of current.guidance??[]){const date=`${guidance.expectedVerificationDate}T00:00:00.000Z`;if(date<=w.generatedAt)events.push({recordedAt:date,effectiveAt:date,type:"guidance_verification"});}
  events.sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt));const latest=events[0];if(!latest)return;
  const sameDay=events.filter(e=>e.recordedAt.slice(0,10)===latest.recordedAt.slice(0,10));
  const priority:Partial<Record<Event["type"],number>>={thesis_revision:100,evidence_invalidation:95,evidence_correction:90,guidance_revision:90,guidance_verification:80,research_model_update:70,verification_upgrade:65,new_disclosure:60,old_evidence_extracted:50,weekly_review:10};
  const event=[...sameDay].sort((a,b)=>(priority[b.type]??0)-(priority[a.type]??0)||b.recordedAt.localeCompare(a.recordedAt))[0]!;
  const cutoff=event.recordedAt;
  const beforeSnapshot=await historicalOperatingSnapshot(pool,actor,w,c,new Date(Date.parse(cutoff)-1).toISOString(),sourceStore);
  const afterSnapshot=await historicalOperatingSnapshot(pool,actor,w,c,event.recordedAt,sourceStore);
  const previous=beforeSnapshot?.reasoning??null,after=afterSnapshot?.reasoning;
  if(!after)return;
  const type=changeTrigger(event.type,previous,after,beforeSnapshot?.questions??[]);
  const change=buildResearchChange(previous,after,type,event.effectiveAt,beforeSnapshot?.fingerprint,beforeSnapshot?.questions,event.sourceIds);
  const weekly=events.some(e=>e.type==="weekly_review"&&e.recordedAt.slice(0,10)===event.recordedAt.slice(0,10));
  if(current.researchUpdate)current.researchUpdate={...current.researchUpdate,id:change.id,reasoningFingerprint:change.afterFingerprint,change,effectiveAt:change.effectiveAt,summary:change.summary+(weekly&&type!=="weekly_review"?"；同日周频证据一并待复核":"")};
}

function changeTrigger(initial:ResearchChangeEvent["triggerType"],previous:ResearchOperatingReasoning|null,after:ResearchOperatingReasoning,previousQuestions:NonNullable<ResearchOperatingReasoning["researchQuestions"]>):ResearchChangeEvent["triggerType"] {
  let type=initial;
  if(!["thesis_revision","guidance_verification","guidance_revision","evidence_correction","evidence_invalidation"].includes(type)&&previous){
    if(operatingModelFingerprint(previous.thesisUpdate?.tests??[])!==operatingModelFingerprint(after.thesisUpdate?.tests??[]))type="thesis_test_changed";
    else if(previous.scenarios.some(s=>s.status==="complete"&&after.scenarios.find(c=>c.name===s.name)?.status!=="complete"))type="scenario_invalidation";
    else if(previous.gaps?.some(g=>!after.gaps?.some(c=>c.metric===g.metric)))type="unknown_closed";
  }
  if(after.researchQuestions?.some(q=>q.status==="RESOLVED"&&previousQuestions.some(p=>p.questionId===q.questionId&&p.status!=="RESOLVED"))&&!["thesis_revision","evidence_correction","guidance_revision","thesis_test_changed"].includes(type))type="question_resolved";
  if(after.researchQuestions?.some(q=>q.status!=="RESOLVED"&&previousQuestions.some(p=>p.questionId===q.questionId&&p.status==="RESOLVED")))type="question_reopened";
  return type;
}
