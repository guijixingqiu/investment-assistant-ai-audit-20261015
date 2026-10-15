import type {Pool,PoolClient} from "pg";
import type {AuthenticatedResearchActor} from "./domain.js";
import {ResearchContextError,readResearchContextSnapshot,findByIdempotency,rowToResearchContextSnapshot,writeEnvelope} from "./researchContextRepository.js";
import {readCandidateMembershipById} from "./candidateMembershipPersistence.js";
import {readDeepResearchWorkspace} from "./deepResearchReadRepository.js";
import {readResearchFundamentals} from "./researchFundamentalRepository.js";
import {researchFundamentalCurrentlyUsable} from "../../../../packages/contracts/src/researchFundamentals.js";
import type {SourceSnapshotStoreOptions} from "./researchSourceSnapshotRepository.js";

const sourceReadOptions=(sourceStore?:SourceSnapshotStoreOptions)=>({accountScopeId:null,
  currentPortfolioEnabled:false,currentPortfolioMaxAgeSeconds:300,sourceStore});
import {saveOperatingModel,assertOwnerFixtureIsolation} from "./researchOperatingModelRepository.js";
import {sameThesisIdentity,type ResearchOperatingReasoning} from "../../../../packages/contracts/src/researchOperatingReasoning.js";
import {operatingModelFingerprint,validateOperatingModel,type OperatingResearchModel,type OperatingThesisOwnerAction} from "../../../../packages/contracts/src/researchOperatingModel.js";
import {assumptionLedger,calculateUnderwriting,scenarioChanges,scenarioPeriod,semanticAssumptionFingerprint,underwritingSharesIdentity,validNextValidationEvent,validateUnderwritingProjection,type ResearchScenarioVersion,type ResearchBaselineSnapshot,type ResearchThesisActionEvent,type ResearchNextValidationEvent,type OwnerThesisAction,type ScenarioPeriodType} from "../../../../packages/contracts/src/researchUnderwriting.js";
import {buildSharesReference} from "../../../../packages/contracts/src/researchOperatingCalculations.js";
import {currentThesisText,projectThesisFormation} from "../../../../packages/contracts/src/thesisFormation.js";
import {projectCurrentBaseFormation} from "../../../../packages/contracts/src/currentBaseFormation.js";
import {baselineEligibility,researchBaselinePreview} from "../../../../packages/contracts/src/researchBaselineConfirmation.js";

interface ScenarioRow {id:string;candidate_membership_id:string;captured_membership_version:number;symbol:string;actor_type:string;actor_id:string;scenario_period_type:ScenarioPeriodType;period_start:Date|string;period_end:Date|string;version:number;parent_version_id:string|null;context_id:string;model_fingerprint:string;model_payload:OperatingResearchModel;assumptions_payload:ResearchScenarioVersion["assumptions"];calculation_version:string;change_reason:string;created_at:Date|string;request_fingerprint:string}
interface BaselineRow {id:string;candidate_membership_id:string;captured_membership_version:number;symbol:string;actor_type:string;actor_id:string;scenario_version_id:string;snapshot_payload:ResearchBaselineSnapshot;snapshot_fingerprint:string;created_at:Date|string;request_fingerprint:string}
function iso(v:Date|string){return new Date(v).toISOString();}
function date(v:Date|string){return typeof v==="string"?v.slice(0,10):`${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,"0")}-${String(v.getDate()).padStart(2,"0")}`;}
function scenario(row:ScenarioRow):ResearchScenarioVersion {
 if(!validateOperatingModel(row.model_payload).ok||operatingModelFingerprint(row.model_payload)!==row.model_fingerprint)throw new ResearchContextError(503,"SCENARIO_INTEGRITY_FAILED","stored scenario model is not internally consistent");
 const period=scenarioPeriod(row.model_payload),start=date(row.period_start),end=date(row.period_end);
 if(!period||period.type!==row.scenario_period_type||period.period.start!==start||period.period.end!==end)throw new ResearchContextError(503,"SCENARIO_PERIOD_DRIFT","stored scenario period does not match model");
 const expected=assumptionLedger(row.model_payload,operatingModelFingerprint({symbol:row.symbol,membershipId:String(row.candidate_membership_id),membershipVersion:Number(row.captured_membership_version),periodType:row.scenario_period_type,start,end}),Number(row.version),row.actor_id,iso(row.created_at),null);
 if(expected.length!==row.assumptions_payload.length||expected.some((a,i)=>{const stored=row.assumptions_payload[i];return !stored||a.variable!==stored.variable||a.value!==stored.value||a.origin!==stored.origin||a.reason!==stored.reason||operatingModelFingerprint(a.basedOnFactIds)!==operatingModelFingerprint(stored.basedOnFactIds)||operatingModelFingerprint(a.basedOnGuidanceIds)!==operatingModelFingerprint(stored.basedOnGuidanceIds)}))throw new ResearchContextError(503,"ASSUMPTION_LEDGER_DRIFT","stored assumptions do not match immutable model inputs");
 return {scenarioId:operatingModelFingerprint({symbol:row.symbol,membershipId:String(row.candidate_membership_id),membershipVersion:Number(row.captured_membership_version),periodType:row.scenario_period_type,start,end}),version:Number(row.version),parentVersion:row.version>1?Number(row.version)-1:null,contextId:String(row.context_id),symbol:row.symbol,membershipId:String(row.candidate_membership_id),membershipVersion:Number(row.captured_membership_version),scenarioPeriodType:row.scenario_period_type,period:period.period,assumptions:row.assumptions_payload,modelFingerprint:row.model_fingerprint,calculationVersion:"underwriting-calculation-v1",changeReason:row.change_reason,createdAt:iso(row.created_at),actor:row.actor_id,model:row.model_payload};
}
async function scenarioRows(pool:Pick<Pool|PoolClient,"query">,membershipId:string,actor:AuthenticatedResearchActor,type:ScenarioPeriodType):Promise<ScenarioRow[]>{
 const rows=await pool.query<ScenarioRow>(`select s.* from research_underwriting_scenario_versions s join candidate_memberships cm on cm.id=s.candidate_membership_id where cm.id=$1 and cm.actor_type=$2 and cm.actor_id=$3 and cm.version=s.captured_membership_version and cm.symbol=s.symbol and s.scenario_period_type=$4 order by s.period_end desc,s.version desc,s.created_at desc,s.id desc limit 100`,[membershipId,actor.actorType,actor.actorId,type]);
 return rows.rows;
}
async function latestBaseline(pool:Pick<Pool|PoolClient,"query">,membershipId:string,actor:AuthenticatedResearchActor,type:ScenarioPeriodType):Promise<ResearchBaselineSnapshot|null>{
 const row=(await pool.query<BaselineRow>(`select b.* from research_baseline_snapshots b join candidate_memberships cm on cm.id=b.candidate_membership_id join research_underwriting_scenario_versions s on s.id=b.scenario_version_id where cm.id=$1 and cm.actor_type=$2 and cm.actor_id=$3 and cm.version=b.captured_membership_version and cm.symbol=b.symbol and s.scenario_period_type=$4 order by b.created_at desc,b.id desc limit 1`,[membershipId,actor.actorType,actor.actorId,type])).rows[0];
 if(!row)return null;if(operatingModelFingerprint(row.snapshot_payload)!==row.snapshot_fingerprint||row.snapshot_payload.baselineId!==row.id)throw new ResearchContextError(503,"BASELINE_INTEGRITY_FAILED","stored immutable baseline fingerprint does not match");return row.snapshot_payload;
}
async function baselineById(pool:Pick<Pool|PoolClient,"query">,membershipId:string,actor:AuthenticatedResearchActor,baselineId:string):Promise<ResearchBaselineSnapshot|null>{
 const row=(await pool.query<BaselineRow>(`select b.* from research_baseline_snapshots b join candidate_memberships cm on cm.id=b.candidate_membership_id where b.id=$1 and cm.id=$2 and cm.actor_type=$3 and cm.actor_id=$4 and cm.version=b.captured_membership_version and cm.symbol=b.symbol`,[baselineId,membershipId,actor.actorType,actor.actorId])).rows[0];
 if(!row)return null;if(operatingModelFingerprint(row.snapshot_payload)!==row.snapshot_fingerprint)throw new ResearchContextError(503,"BASELINE_INTEGRITY_FAILED","stored immutable baseline fingerprint does not match");return row.snapshot_payload;
}
async function milestoneBaseline(pool:Pick<Pool|PoolClient,"query">,membershipId:string,actor:AuthenticatedResearchActor,type:ScenarioPeriodType,baselineId:string,lineageId:string):Promise<ResearchBaselineSnapshot>{
 const row=(await pool.query<BaselineRow & {scenario_period_type:ScenarioPeriodType}>(`select b.*,s.scenario_period_type from research_baseline_snapshots b join research_underwriting_scenario_versions s on s.id=b.scenario_version_id join candidate_memberships cm on cm.id=b.candidate_membership_id where b.id=$1 and cm.id=$2 and cm.actor_type=$3 and cm.actor_id=$4 and cm.version=b.captured_membership_version and cm.symbol=b.symbol and s.candidate_membership_id=b.candidate_membership_id and s.captured_membership_version=b.captured_membership_version and s.actor_type=b.actor_type and s.actor_id=b.actor_id`,[baselineId,membershipId,actor.actorType,actor.actorId])).rows[0];
 const baseline=row?.snapshot_payload;
 if(!row||row.scenario_period_type!==type||!baseline||baseline.baselineId!==row.id||baseline.membershipId!==membershipId||baseline.membershipVersion!==Number(row.captured_membership_version)||baseline.symbol!==row.symbol||baseline.thesisLineageId!==lineageId)throw new ResearchContextError(409,"MILESTONE_BASELINE_DRIFT","milestone Baseline identity, period or Thesis lineage changed");
 if(operatingModelFingerprint(baseline)!==row.snapshot_fingerprint)throw new ResearchContextError(503,"BASELINE_INTEGRITY_FAILED","stored immutable baseline fingerprint does not match");
 return baseline;
}
async function actionHistory(pool:Pick<Pool|PoolClient,"query">,membershipId:string,actor:AuthenticatedResearchActor):Promise<ResearchThesisActionEvent[]>{
 const rows=await pool.query<{action:OperatingThesisOwnerAction}>(`select distinct on (context_payload->'operatingModel'->'thesisOwnerAction'->>'actionId') context_payload->'operatingModel'->'thesisOwnerAction' action
 from research_context_snapshots where candidate_membership_id=$1 and actor_type=$2 and actor_id=$3 and context_payload->'operatingModel'->'thesisOwnerAction' is not null
 and captured_membership_version=(select version from candidate_memberships where id=$1 and actor_type=$2 and actor_id=$3)
 order by context_payload->'operatingModel'->'thesisOwnerAction'->>'actionId',created_at asc,id asc`,[membershipId,actor.actorType,actor.actorId]);
 return rows.rows.map(r=>r.action).sort((a,b)=>a.confirmedAt.localeCompare(b.confirmedAt));
}
async function readUnderwriting(pool:Pool|PoolClient,membershipId:string,actor:AuthenticatedResearchActor,type:ScenarioPeriodType,now:Date,anchor:{baselineId:string;lineageId:string}|null,sourceStore?:SourceSnapshotStoreOptions){
 const member=await readCandidateMembershipById(pool,actor,membershipId);if(!member||member.state!=="tracked")throw new ResearchContextError(409,"MEMBERSHIP_UNAVAILABLE","tracked membership required");
 const [rows,baseline,actions,workspace]=await Promise.all([scenarioRows(pool,membershipId,actor,type),anchor?milestoneBaseline(pool,membershipId,actor,type,anchor.baselineId,anchor.lineageId):latestBaseline(pool,membershipId,actor,type),actionHistory(pool,membershipId,actor),readDeepResearchWorkspace(pool,membershipId,actor,now,sourceReadOptions(sourceStore))]);
 const reasoning=workspace.data?.operatingReasoning;
 if(!reasoning)return {status:"no_operating_reasoning",symbol:member.symbol,membershipId,membershipVersion:Number(member.version),currentBase:null,baseline:null,ownerAccepted:"UNKNOWN"};
 const versions=rows.map(scenario),current=versions[0]??null,previous=versions.slice(1).find(v=>v.scenarioId===current?.scenarioId)??null;
 const projected=calculateUnderwriting(reasoning,current,previous,baseline,actions,workspace.generatedAt);
 if(!validateUnderwritingProjection(projected,reasoning,workspace.generatedAt))throw new ResearchContextError(503,"UNDERWRITING_CALCULATION_FAILED","canonical underwriting recalculation failed");
 return {status:"available",...projected,ownerAccepted:"UNKNOWN"};
}
export async function readResearchUnderwriting(pool:Pool|PoolClient,membershipId:string,actor:AuthenticatedResearchActor,type:ScenarioPeriodType="CURRENT_FY",now=new Date(),sourceStore?:SourceSnapshotStoreOptions){return readUnderwriting(pool,membershipId,actor,type,now,null,sourceStore);}
export async function readResearchUnderwritingAtBaseline(pool:Pool|PoolClient,membershipId:string,actor:AuthenticatedResearchActor,type:ScenarioPeriodType,baselineId:string,lineageId:string,now=new Date(),sourceStore?:SourceSnapshotStoreOptions){return readUnderwriting(pool,membershipId,actor,type,now,{baselineId,lineageId},sourceStore);}
function requireRequest(body:unknown,keys:string[]):Record<string,unknown>{if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).sort().join()!==keys.sort().join())throw new ResearchContextError(422,"INVALID_UNDERWRITING_REQUEST","unexpected request fields");return body as Record<string,unknown>;}
async function lockedMember(client:PoolClient,id:string,actor:AuthenticatedResearchActor){const row=(await client.query<{symbol:string;version:number;state:string}>(`select symbol,version,state from candidate_memberships where id=$1 and actor_type=$2 and actor_id=$3 for update`,[id,actor.actorType,actor.actorId])).rows[0];if(!row||row.state!=="tracked")throw new ResearchContextError(409,"MEMBERSHIP_UNAVAILABLE","tracked membership changed");return row;}
function validBaseVersionRequest(r:Record<string,unknown>):boolean {return typeof r.contextId==="string"&&/^\d+$/.test(r.contextId)&&Number.isSafeInteger(r.membershipVersion)&&["CURRENT_FY","NEXT_REPORTING_PERIOD"].includes(String(r.scenarioPeriodType))&&typeof r.changeReason==="string"&&r.changeReason.length<=2000&&typeof r.idempotencyKey==="string"&&r.idempotencyKey.length>=8;}
function assertBaseModel(model:OperatingResearchModel,type:unknown){
 const period=scenarioPeriod(model);if(!period||period.type!==type)throw new ResearchContextError(422,"SCENARIO_PERIOD_MISMATCH","Bear/Base/Bull must share one explicit FY or next reporting period");
 const base=model.scenarios[1]!;
 if(model.peSensitivityValues?.length&&(!base.inputs.pe.value||!model.peSensitivityValues.includes(base.inputs.pe.value)))throw new ResearchContextError(422,"CENTRAL_PE_REQUIRED","Owner PE sensitivity must include the explicit central PE");
 const inputs=[...Object.values(base.inputs),...(base.revenueComposition?[base.revenueComposition.otherRevenue]:[])];
 if(inputs.some(input=>input.origin==="owner_assumption"&&!input.note.trim()))throw new ResearchContextError(422,"ASSUMPTION_REASON_REQUIRED","new key Owner assumptions require a reason");
 return period;
}
async function assertCurrentBaseEligibility(client:PoolClient,id:string,actor:AuthenticatedResearchActor,member:{symbol:string;version:number},contextId:string,model:OperatingResearchModel,type:ScenarioPeriodType,initial:boolean,now:Date,sourceStore?:SourceSnapshotStoreOptions):Promise<void>{
 if(!model.thesisBinding)throw new ResearchContextError(409,"FORMAL_THESIS_REQUIRED","a Base requires a formal Thesis");
 if(model.thesisOwnerAction?.action==="INVALIDATE_OR_END_THESIS")throw new ResearchContextError(409,"ENDED_THESIS_REQUIRES_NEW_LINEAGE","ended Thesis cannot anchor a new Base version");
 const workspace=await readDeepResearchWorkspace(client,id,actor,now,sourceReadOptions(sourceStore)),reasoning=workspace.data?.operatingReasoning;
 const thesis=projectThesisFormation(workspace,contextId,model,now,actor.actorType);
 if(workspace.status!=="available"||workspace.data?.target.symbol!==member.symbol||workspace.data.target.membershipId!==id||workspace.data.target.membershipVersion!==member.version||thesis.status!=="BOUND"||thesis.currentLineage?.state!=="ACTIVE"||!reasoning||reasoning.contextId!==contextId||reasoning.symbol!==member.symbol||reasoning.membershipId!==id||reasoning.membershipVersion!==member.version||operatingModelFingerprint(reasoning.model)!==operatingModelFingerprint(model))throw new ResearchContextError(409,"CONTEXT_VERSION_CONFLICT","current Thesis, Context or operating reasoning changed");
 if(initial&&projectCurrentBaseFormation(thesis,reasoning,type,null,"NONE",now).status!=="READY_TO_SAVE")throw new ResearchContextError(409,"CURRENT_BASE_NOT_READY","canonical first Base is incomplete or blocked");
}
export async function saveCurrentBaseVersion(pool:Pool,id:string,actor:AuthenticatedResearchActor,body:unknown,now=new Date(),sourceStore?:SourceSnapshotStoreOptions){
 if(actor.actorType!=="user")throw new ResearchContextError(422,"OWNER_ACTION_REQUIRED","explicit Owner actor required");
 const r=requireRequest(body,["contextId","membershipVersion","scenarioPeriodType","changeReason","idempotencyKey"]);
 if(!validBaseVersionRequest(r))throw new ResearchContextError(422,"INVALID_BASE_VERSION","explicit context, period and idempotency key required");
 const fp=operatingModelFingerprint({actor,id,request:r}),client=await pool.connect();try{await client.query("begin isolation level repeatable read");
 const member=await lockedMember(client,id,actor);if(member.version!==r.membershipVersion)throw new ResearchContextError(409,"MEMBERSHIP_VERSION_DRIFT","membership changed");
 const replay=(await client.query<ScenarioRow>(`select * from research_underwriting_scenario_versions where actor_type=$1 and actor_id=$2 and idempotency_key=$3`,[actor.actorType,actor.actorId,r.idempotencyKey])).rows[0];
 if(replay){if(replay.request_fingerprint!==fp)throw new ResearchContextError(409,"IDEMPOTENCY_CONFLICT","key belongs to another Base version");await client.query("commit");return scenario(replay);}
 const context=await readResearchContextSnapshot(client,id,actor,now),model=context.data?.operatingModel;
 if(context.data?.id!==r.contextId||context.data?.currentness.status!=="current"||!model||!validateOperatingModel(model).ok)throw new ResearchContextError(409,"CONTEXT_VERSION_CONFLICT","current model changed or is unavailable");
 assertOwnerFixtureIsolation(model,actor);
 const period=assertBaseModel(model,r.scenarioPeriodType);
 const previousRow=(await client.query<ScenarioRow>(`select * from research_underwriting_scenario_versions where candidate_membership_id=$1 and captured_membership_version=$2 and scenario_period_type=$3 and period_start=$4 and period_end=$5 order by version desc limit 1 for update`,[id,member.version,period.type,period.period.start,period.period.end])).rows[0];
 await assertCurrentBaseEligibility(client,id,actor,member,context.data.id,model,period.type,!previousRow,now,sourceStore);
 const previous=previousRow?scenario(previousRow):null,version=(previous?.version??0)+1,scenarioId=operatingModelFingerprint({symbol:member.symbol,membershipId:id,membershipVersion:member.version,periodType:period.type,start:period.period.start,end:period.period.end});
 const ledger=assumptionLedger(model,scenarioId,version,actor.actorId,now.toISOString(),previous),draft:ResearchScenarioVersion={scenarioId,version,parentVersion:previous?.version??null,contextId:String(r.contextId),symbol:member.symbol,membershipId:id,membershipVersion:member.version,scenarioPeriodType:period.type,period:period.period,assumptions:ledger,modelFingerprint:operatingModelFingerprint(model),calculationVersion:"underwriting-calculation-v1",changeReason:String(r.changeReason).trim()||"Initial Current Base version",createdAt:now.toISOString(),actor:actor.actorId,model};
 if(previous&&scenarioChanges(draft,previous).assumptionChanges.length>0&&!String(r.changeReason).trim())throw new ResearchContextError(422,"BASE_CHANGE_REASON_REQUIRED","changed key assumptions need a reason before a formal Base version is saved");
 const row=(await client.query<ScenarioRow>(`insert into research_underwriting_scenario_versions(candidate_membership_id,captured_membership_version,symbol,actor_type,actor_id,scenario_period_type,period_start,period_end,version,parent_version_id,context_id,model_fingerprint,model_payload,assumptions_payload,calculation_version,change_reason,idempotency_key,request_fingerprint,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning *`,[id,member.version,member.symbol,actor.actorType,actor.actorId,period.type,period.period.start,period.period.end,version,previousRow?.id??null,r.contextId,draft.modelFingerprint,JSON.stringify(model),JSON.stringify(ledger),draft.calculationVersion,draft.changeReason,r.idempotencyKey,fp,now])).rows[0]!;
 await client.query("commit");return scenario(row);
 }catch(error){await client.query("rollback");throw error;}finally{client.release();}
}
async function assertBaselineSaveEligibility(client:PoolClient,id:string,actor:AuthenticatedResearchActor,member:{symbol:string;version:number},current:ResearchScenarioVersion,type:ScenarioPeriodType,now:Date,sourceStore?:SourceSnapshotStoreOptions):Promise<{reasoning:ResearchOperatingReasoning;asOf:string}>{
 const workspace=await readDeepResearchWorkspace(client,id,actor,now,sourceReadOptions(sourceStore)),reasoning=workspace.data?.operatingReasoning,context=await readResearchContextSnapshot(client,id,actor,now);
 if(workspace.status!=="available"||workspace.data?.target.symbol!==member.symbol||workspace.data.target.membershipId!==id||workspace.data.target.membershipVersion!==member.version||!reasoning||reasoning.symbol!==member.symbol||reasoning.membershipId!==id||reasoning.membershipVersion!==member.version||reasoning.contextId!==context.data?.id||context.data?.currentness.status!=="current"||operatingModelFingerprint(reasoning.model)!==operatingModelFingerprint(context.data.operatingModel))throw new ResearchContextError(409,"BASELINE_SCENARIO_DRIFT","current Context or research evidence changed");
 const thesis=projectThesisFormation(workspace,context.data.id,context.data.operatingModel??null,now,actor.actorType);
 const savedLineage=current.model.thesisOwnerAction?.lineageId??(current.model.thesisBinding?operatingModelFingerprint(current.model.thesisBinding):null);
 const savedText=currentThesisText(current.model);
 if(thesis.status!=="BOUND"||savedLineage!==thesis.currentLineage?.lineageId||savedText!==thesis.currentLineage?.currentThesisText||!current.model.thesisBinding||!thesis.currentFormalThesis||!sameThesisIdentity(current.model.thesisBinding,thesis.currentFormalThesis))throw new ResearchContextError(409,"BASELINE_THESIS_DRIFT","selected Base belongs to a different formal Thesis lineage");
 if(current.contextId!==context.data.id||current.modelFingerprint!==operatingModelFingerprint(context.data.operatingModel))throw new ResearchContextError(409,"BASELINE_SCENARIO_DRIFT","selected Base is not the exact current Context model");
 const underwriting=await readResearchUnderwriting(client,id,actor,type,now,sourceStore);
 if(!("currentBaseStatus" in underwriting)||underwriting.currentBase?.scenarioId!==current.scenarioId||underwriting.currentBase.version!==current.version)throw new ResearchContextError(409,"BASELINE_SCENARIO_DRIFT","selected Base is no longer current");
 const formation=projectCurrentBaseFormation(thesis,reasoning,type,current,underwriting.currentBaseStatus,now);
 const eligibility=baselineEligibility({symbol:member.symbol,membershipId:id,membershipVersion:member.version,scenarioPeriodType:type},thesis,formation,current,context.data.id,underwriting.currentBaseStatus);
 if(!eligibility.ok)throw new ResearchContextError(409,eligibility.code,"current Base is not eligible for an explicit Baseline");
 return {reasoning,asOf:workspace.generatedAt};
}
export async function saveResearchBaseline(pool:Pool,id:string,actor:AuthenticatedResearchActor,body:unknown,now=new Date(),sourceStore?:SourceSnapshotStoreOptions){
 if(actor.actorType!=="user")throw new ResearchContextError(422,"OWNER_ACTION_REQUIRED","explicit Owner actor required");
 const r=requireRequest(body,["scenarioVersion","scenarioPeriodType","confirmed","idempotencyKey"]);
 if(r.confirmed!==true||!Number.isSafeInteger(r.scenarioVersion)||!["CURRENT_FY","NEXT_REPORTING_PERIOD"].includes(String(r.scenarioPeriodType))||typeof r.idempotencyKey!=="string"||r.idempotencyKey.length<8)throw new ResearchContextError(422,"BASELINE_CONFIRMATION_REQUIRED","explicit confirmation of the current Base version required");
 const fp=operatingModelFingerprint({actor,id,request:r}),client=await pool.connect();try{await client.query("begin isolation level repeatable read");const member=await lockedMember(client,id,actor);
 const replay=(await client.query<BaselineRow>(`select * from research_baseline_snapshots where actor_type=$1 and actor_id=$2 and idempotency_key=$3`,[actor.actorType,actor.actorId,r.idempotencyKey])).rows[0];
 if(replay){if(replay.request_fingerprint!==fp)throw new ResearchContextError(409,"IDEMPOTENCY_CONFLICT","key belongs to another Baseline");await client.query("commit");return replay.snapshot_payload;}
 const row=(await client.query<ScenarioRow>(`select * from research_underwriting_scenario_versions where candidate_membership_id=$1 and captured_membership_version=$2 and scenario_period_type=$3 order by period_end desc,version desc,created_at desc,id desc limit 1`,[id,member.version,r.scenarioPeriodType])).rows[0];
 if(!row||Number(row.version)!==r.scenarioVersion)throw new ResearchContextError(409,"BASELINE_SCENARIO_DRIFT","save a current Base version before confirming a Baseline");
 const current=scenario(row),{reasoning,asOf}=await assertBaselineSaveEligibility(client,id,actor,member,current,r.scenarioPeriodType as ScenarioPeriodType,now,sourceStore);
 const baselineId=(await client.query<{id:string}>(`select gen_random_uuid() id`)).rows[0]!.id;
 const snapshot:ResearchBaselineSnapshot={baselineId,...researchBaselinePreview(reasoning,current,asOf),createdAt:now.toISOString(),actor:actor.actorId};
 await client.query(`insert into research_baseline_snapshots(id,candidate_membership_id,captured_membership_version,symbol,actor_type,actor_id,scenario_version_id,snapshot_payload,snapshot_fingerprint,idempotency_key,request_fingerprint,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[baselineId,id,member.version,member.symbol,actor.actorType,actor.actorId,row.id,JSON.stringify(snapshot),operatingModelFingerprint(snapshot),r.idempotencyKey,fp,now]);
 await client.query("commit");return snapshot;
 }catch(error){await client.query("rollback");throw error;}finally{client.release();}
}
function assertThesisActionRequest(r:Record<string,unknown>):OwnerThesisAction {
 if(r.confirmed!==true||!["KEEP_CURRENT_THESIS","REVISE_THESIS","INSUFFICIENT_EVIDENCE_CONTINUE","INVALIDATE_OR_END_THESIS"].includes(String(r.action))||!Number.isSafeInteger(r.membershipVersion)||typeof r.ownerReason!=="string"||r.ownerReason.trim().length<3||r.ownerReason.length>2000||!Array.isArray(r.triggeringFactIds)||!r.triggeringFactIds.every(x=>typeof x==="string"&&/^\d+$/.test(x))||!validNextValidationEvent(r.nextValidationEvent)||r.baselineId!==null&&(typeof r.baselineId!=="string"||!/^[a-f0-9-]{36}$/.test(r.baselineId))||typeof r.baseContextId!=="string"||typeof r.idempotencyKey!=="string"||r.idempotencyKey.length<8)throw new ResearchContextError(422,"INVALID_THESIS_ACTION","Owner action, reason, validation event and confirmation required");
 const action=r.action as OwnerThesisAction;
 if(action==="REVISE_THESIS"?typeof r.newThesis!=="string"||r.newThesis.trim().length<3:r.newThesis!==null)throw new ResearchContextError(422,"INVALID_THESIS_ACTION","only revision may introduce a new Thesis text");
 return action;
}
async function replayThesisAction(pool:Pool|PoolClient,id:string,actor:AuthenticatedResearchActor,r:Record<string,unknown>,now:Date){
 const replay=await findByIdempotency(pool,actor,String(r.idempotencyKey));if(!replay)return null;
 const prior=(replay.context_payload as {operatingModel?:OperatingResearchModel}).operatingModel?.thesisOwnerAction,actionId=operatingModelFingerprint({actor,id,key:r.idempotencyKey});
 if(prior?.actionId!==actionId||prior.action!==r.action||prior.ownerReason!==r.ownerReason||prior.newThesis!==r.newThesis||operatingModelFingerprint(prior.originalThesisIdentity)!==operatingModelFingerprint(r.originalThesisIdentity)||prior.baseContextId!==r.baseContextId||Number(replay.captured_membership_version)!==r.membershipVersion||operatingModelFingerprint(prior.triggeringFactIds)!==operatingModelFingerprint(r.triggeringFactIds)||operatingModelFingerprint(prior.nextValidationEvent)!==operatingModelFingerprint(r.nextValidationEvent)||prior.baselineId!==r.baselineId)throw new ResearchContextError(409,"IDEMPOTENCY_CONFLICT","key belongs to another research write");
 return writeEnvelope(rowToResearchContextSnapshot(replay,now),actor,"Owner Thesis action replayed.");
}
function assertBaselineThesisLineage(baseline:ResearchBaselineSnapshot|null,original:NonNullable<OperatingResearchModel["thesisBinding"]>,membershipId:string,membershipVersion:number,lineageId:string):void {
 if(!baseline)return;
 if(!baseline.originalThesisIdentity||!sameThesisIdentity(original,baseline.originalThesisIdentity)||baseline.membershipId!==membershipId||baseline.membershipVersion!==membershipVersion||(baseline.thesisLineageId??operatingModelFingerprint(baseline.originalThesisIdentity))!==lineageId)throw new ResearchContextError(409,"BASELINE_THESIS_DRIFT","Baseline belongs to a different Original Thesis or lineage");
}
function nextThesisLineage(previous:OperatingThesisOwnerAction|undefined,original:NonNullable<OperatingResearchModel["thesisBinding"]>,action:OwnerThesisAction,newThesis:unknown,actionId:string):string {
 if(previous?.action==="INVALIDATE_OR_END_THESIS"){
  if(action!=="REVISE_THESIS")throw new ResearchContextError(409,"ENDED_THESIS_REQUIRES_NEW_LINEAGE","an ended Thesis can only be followed by an explicit new Thesis revision lineage");
  return operatingModelFingerprint({previous:previous.lineageId,newThesis,actionId});
 }
 return previous?.lineageId??operatingModelFingerprint(original);
}
export async function saveThesisOwnerAction(pool:Pool|PoolClient,id:string,actor:AuthenticatedResearchActor,body:unknown,now=new Date(),sourceStore?:SourceSnapshotStoreOptions){
 if(actor.actorType!=="user")throw new ResearchContextError(422,"OWNER_ACTION_REQUIRED","explicit Owner actor required");
 const r=requireRequest(body,["action","originalThesisIdentity","newThesis","ownerReason","triggeringFactIds","nextValidationEvent","baselineId","baseContextId","membershipVersion","confirmed","idempotencyKey"]);
 const action=assertThesisActionRequest(r),actionId=operatingModelFingerprint({actor,id,key:r.idempotencyKey});
 const replay=await replayThesisAction(pool,id,actor,r,now);if(replay)return replay;
 const member=await readCandidateMembershipById(pool,actor,id),context=await readResearchContextSnapshot(pool,id,actor,now),old=context.data?.operatingModel;
 if(!member||member.state!=="tracked"||Number(member.version)!==r.membershipVersion||context.data?.id!==r.baseContextId||context.data?.currentness.status!=="current"||!old?.thesisBinding||!r.originalThesisIdentity||!sameThesisIdentity(old.thesisBinding,r.originalThesisIdentity as OperatingResearchModel["thesisBinding"] & object))throw new ResearchContextError(409,"THESIS_ACTION_DRIFT","reload current explicit Thesis and context");
 const fundamentals=await readResearchFundamentals(pool,id,actor,now,undefined,sourceStore),valid=new Set(fundamentals.values.filter(f=>researchFundamentalCurrentlyUsable(f)&&f.membershipVersionAtWrite===Number(member.version)).map(f=>f.id));
 if((r.triggeringFactIds as string[]).some(fid=>!valid.has(fid)))throw new ResearchContextError(409,"THESIS_EVIDENCE_DRIFT","triggering evidence must remain current");
 const baseline=r.baselineId===null?null:await baselineById(pool,id,actor,String(r.baselineId));if(r.baselineId!==null&&baseline?.baselineId!==r.baselineId)throw new ResearchContextError(409,"BASELINE_DRIFT","baseline identity changed");
 const existingLineage=old.thesisOwnerAction?.lineageId??operatingModelFingerprint(old.thesisBinding);
 assertBaselineThesisLineage(baseline,old.thesisBinding,id,Number(member.version),existingLineage);
 const previous=old.thesisOwnerAction,lineageId=nextThesisLineage(previous,old.thesisBinding,action,r.newThesis,actionId);
 const event:OperatingThesisOwnerAction={actionId,action,originalThesisIdentity:old.thesisBinding,lineageId,previousLineageId:previous?.action==="INVALIDATE_OR_END_THESIS"?previous.lineageId:null,newThesis:r.newThesis as string|null,ownerReason:String(r.ownerReason),endedAt:action==="INVALIDATE_OR_END_THESIS"?now.toISOString():null,triggeringFactIds:r.triggeringFactIds as string[],nextValidationEvent:r.nextValidationEvent as ResearchNextValidationEvent,baselineId:baseline?.baselineId??null,baseContextId:String(r.baseContextId),confirmedAt:now.toISOString(),actor:actor.actorId};
 const model=structuredClone(old);model.thesisOwnerAction=event;
 if(action==="REVISE_THESIS")model.thesisRevision={previous:old.thesisBinding,status:"OWNER_CONFIRMED",assessment:context.data?.operatingModel?.thesisRevision?.assessment??"insufficient_evidence",evidenceFactIds:event.triggeringFactIds,retainedEvidence:[],weakenedParts:[],newThesis:String(r.newThesis),reason:event.ownerReason,addedHypotheses:[],abandonedHypotheses:[],previousValidationEvent:old.thesisRevision?.nextValidationEvent??"",nextValidationEvent:event.nextValidationEvent.description,confirmedAt:now.toISOString(),actor:actor.actorId};
 return saveOperatingModel(pool,id,{baseContextId:r.baseContextId,membershipVersion:Number(member.version),selectedSymbol:member.symbol,operatingModel:model,idempotencyKey:r.idempotencyKey},actor,now,"OWNER_ACTION",sourceStore);
}
