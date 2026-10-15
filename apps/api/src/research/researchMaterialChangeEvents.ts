import type {Pool,PoolClient} from "pg";
import type {AuthenticatedResearchActor} from "./domain.js";
import type {DeepResearchWorkspaceEnvelope} from "../../../../packages/contracts/src/deepResearch.js";
import {readResearchContextSnapshot} from "./researchContextRepository.js";
import {historicalOperatingSnapshot} from "./researchHistoricalReasoning.js";
import {operatingModelFingerprint} from "../../../../packages/contracts/src/researchOperatingModel.js";
import type {ResearchChangeEvent,ResearchUpdateNotice} from "../../../../packages/contracts/src/researchDecisionUpdate.js";
import type {SourceSnapshotStoreOptions} from "./researchSourceSnapshotRepository.js";
export async function readMaterialRevisionEvents(pool:Pick<Pool|PoolClient,"query">,actor:AuthenticatedResearchActor,id:string,version:number,cutoff:string){
  const rows=await pool.query<{id:string;created_at:Date|string;replaces_material_id:string}>(`select m.id,m.created_at,m.replaces_material_id
    from research_materials m join evidence_items source on source.id=m.evidence_item_id
    join candidate_memberships cm on cm.id=m.candidate_membership_id
    left join research_documents d on d.id=m.citation_document_id
    left join research_source_snapshots s on s.id=m.citation_snapshot_id and s.candidate_membership_id=m.candidate_membership_id
    where cm.id=$1 and cm.actor_type=$2 and cm.actor_id=$3 and cm.version=$4
      and (d.captured_membership_version=$4 or s.captured_membership_version=$4)
      and m.replaces_material_id is not null and m.created_at<=$5
      and source.source_type <> 'owner_ocr_correction_note'
    order by m.created_at desc,m.id desc limit 100`,[id,actor.actorType,actor.actorId,version,cutoff]);
  const lifecycle=await pool.query<{id:string;created_at:Date|string;fundamental_value_id:string;status:string;source_material_id:string|null}>(`select e.id,e.created_at,e.fundamental_value_id,e.status,e.source_material_id from research_fundamental_assertion_lifecycle e join candidate_memberships cm on cm.id=e.candidate_membership_id where e.candidate_membership_id=$1 and cm.actor_type=$2 and cm.actor_id=$3 and e.captured_membership_version=$4 and e.created_at<=$5 order by e.created_at desc,e.id desc limit 100`,[id,actor.actorType,actor.actorId,version,cutoff]);
  return [...rows.rows.map(r=>({recordedAt:new Date(r.created_at).toISOString(),effectiveAt:new Date(r.created_at).toISOString(),type:"evidence_correction" as const,sourceIds:[String(r.id),String(r.replaces_material_id)],reason:"MATERIAL_REVISION"})),...lifecycle.rows.map(r=>({recordedAt:new Date(r.created_at).toISOString(),effectiveAt:new Date(r.created_at).toISOString(),type:"evidence_invalidation" as const,sourceIds:[String(r.fundamental_value_id),...(r.source_material_id?[String(r.source_material_id)]:[])],reason:r.status}))].sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt));
}
/** Source invalidation must remain visible even when no current fact can anchor an operating model. */
export async function materialInvalidationNotice(pool:Pool,actor:AuthenticatedResearchActor,w:DeepResearchWorkspaceEnvelope,sourceStore?:SourceSnapshotStoreOptions):Promise<ResearchUpdateNotice|null>{
  const target=w.data?.target;if(!target)return null;
  const events=await readMaterialRevisionEvents(pool,actor,target.membershipId,target.membershipVersion,w.generatedAt),event=events[0];if(!event)return null;
  const context=await readResearchContextSnapshot(pool,target.membershipId,actor,new Date(w.generatedAt));
  const before=await historicalOperatingSnapshot(pool,actor,w,context,new Date(Date.parse(event.recordedAt)-1).toISOString(),sourceStore),after=await historicalOperatingSnapshot(pool,actor,w,context,event.recordedAt,sourceStore);
  if(!before||!after)return null;
  const reopened=before.questions.some(q=>q.status==="RESOLVED"&&after.questions.some(a=>a.questionId===q.questionId&&a.status!=="RESOLVED"));
  const data:Omit<ResearchChangeEvent,"id">={triggerType:reopened?"question_reopened":event.type,beforeFingerprint:before.fingerprint,afterFingerprint:after.fingerprint,changedFactIds:before.reasoning?.facts.filter(f=>event.sourceIds.includes(f.id)||event.sourceIds.includes(f.source.materialId)).map(f=>f.id)??[],changedGapReasons:[],previousAssessment:before.reasoning?.thesisUpdate?.assessment??null,currentAssessment:after.reasoning?.thesisUpdate?.assessment??null,previousScenarioStatus:before.reasoning?.scenarios.map(s=>`${s.name}:${s.status}`).join()??null,currentScenarioStatus:after.reasoning?.scenarios.map(s=>`${s.name}:${s.status}`).join()??"UNKNOWN",guidanceEvent:null,thesisRevisionEvent:null,effectiveAt:event.effectiveAt,sourceIds:event.sourceIds,summary:(reopened?"研究问题重新打开：":"")+(event.type==="evidence_invalidation"?`证据 ${event.reason}，原始断言仍保留于历史序列；当前比较不再采用。`:"原先依赖的材料版本已被修订；旧结构化数值暂不可用于当前判断，请重新核对来源并追加对应事实。")};
  const id=operatingModelFingerprint({symbol:target.symbol,membershipId:target.membershipId,membershipVersion:target.membershipVersion,...data});
  return {id,symbol:target.symbol,membershipId:target.membershipId,membershipVersion:target.membershipVersion,reasoningFingerprint:after.fingerprint,triggerType:"research_update",title:event.type==="evidence_invalidation"?"Research Update · 证据失效":"Research Update · 来源修订待核对",summary:data.summary,nextQuestion:"修订后的原始材料是否需要更正已有结构化数值？",effectiveAt:event.effectiveAt,change:{id,...data}};
}
