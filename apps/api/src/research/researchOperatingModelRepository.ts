import { sameThesisIdentity } from "../../../../packages/contracts/src/researchOperatingReasoning.js";
import { requestFingerprint } from "./deepResearchGate.js";
import { readCandidateMembershipById } from "./candidateMembershipPersistence.js";
import type { Pool,PoolClient } from "pg";
import type { CreateResearchContextRequest } from "../../../../packages/contracts/src/researchContext.js";
import { operatingModelFingerprint, validateOperatingModel, type ExplicitThesisBinding, type OperatingResearchModel } from "../../../../packages/contracts/src/researchOperatingModel.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import { ResearchContextError,readResearchContextSnapshot,createResearchContextSnapshot,findByIdempotency,rowToResearchContextSnapshot,writeEnvelope } from "./researchContextRepository.js";
import { readDeepResearchReportForReplay } from "./deepResearchPersistence.js";
import { readResearchFundamentals } from "./researchFundamentalRepository.js";
import { researchFundamentalCurrentlyUsable } from "../../../../packages/contracts/src/researchFundamentals.js";
import type { SourceSnapshotStoreOptions } from "./researchSourceSnapshotRepository.js";

export async function assertOperatingModelReferences(client:Pick<Pool|PoolClient,"query">,membershipId:string,request:CreateResearchContextRequest,actor:AuthenticatedResearchActor,now:Date,sourceStore?:SourceSnapshotStoreOptions):Promise<void> {
  const model=request.operatingModel;if(!model)return;
  if(actor.actorType!=="user")throw new ResearchContextError(400,"OWNER_MODEL_REQUIRED","only explicit Owner drafts may set the operating model");
  assertOwnerFixtureIsolation(model,actor);
  await assertThesisReferences(client,membershipId,request,actor,now);
  const fundamentals=await readResearchFundamentals(client,membershipId,actor,now,undefined,sourceStore);
  const current=fundamentals.values.filter(f=>researchFundamentalCurrentlyUsable(f)&&f.membershipVersionAtWrite===request.membershipVersion&&f.symbol===request.selectedSymbol&&f.assertion?.sourceChecked&&["verified","owner_confirmed","source_text_verified"].includes(f.provenance.verificationStatus));
  const ids=[...(model.thesisRevision?.evidenceFactIds??[]),...model.scenarios.flatMap(s=>[...Object.values(s.inputs),...(s.revenueComposition?[s.revenueComposition.otherRevenue]:[])].flatMap(i=>[i.sourceValueId,...(i.rationale?.basedOnFactIds??[])])),model.sharesValueId].filter((id):id is string=>id!==null);
  if(ids.some(id=>!current.some(f=>f.id===id)))throw new ResearchContextError(409,"MODEL_SOURCE_DRIFT","operating model source must match current actor, symbol, membership and revision");
  const guidanceIds=model.scenarios.flatMap(s=>[...Object.values(s.inputs),...(s.revenueComposition?[s.revenueComposition.otherRevenue]:[])].flatMap(i=>i.rationale?.basedOnGuidanceIds??[]));
  if(guidanceIds.some(id=>!current.some(f=>f.id===id&&f.assertion?.category==="guidance")))throw new ResearchContextError(409,"GUIDANCE_REFERENCE_DRIFT","guidance reference must remain a source-bound guidance fact for this membership");
  if(model.sharesValueId&&!current.some(f=>f.id===model.sharesValueId&&["shares_outstanding","issued_shares"].includes(f.metric)&&f.periodKind==="instant"&&f.assertion?.unit==="shares"))throw new ResearchContextError(400,"INVALID_SHARES_REFERENCE","shares reference must be a dated disclosed shares fact");
  if(model.fx&&model.fx.asOf>now.toISOString().slice(0,10))throw new ResearchContextError(400,"FUTURE_FX","future FX is not an observed conversion reference");
}
async function assertThesisReferences(client:Pick<Pool|PoolClient,"query">,membershipId:string,request:CreateResearchContextRequest,actor:AuthenticatedResearchActor,now:Date):Promise<void> {
  const model=request.operatingModel;if(!model)return;
  const binding=model.thesisBinding;
  if(binding){const report=await readDeepResearchReportForReplay(client,binding.reportId,membershipId),payload=report?.payload;
    const pack=payload&&"evidencePackBinding" in payload?payload.evidencePackBinding:null;
    const conditions=payload&&"adviceLayer" in payload?payload.adviceLayer.longTerm.conditions:[];
    if(!report||report.version!==binding.reportVersion||report.reportFingerprint!==binding.reportFingerprint||pack?.membershipVersion!==request.membershipVersion||pack.symbol!==request.selectedSymbol||pack.membershipId!==membershipId||conditions[binding.conditionIndex]!==binding.conditionText)throw new ResearchContextError(409,"THESIS_BINDING_DRIFT","explicit report, version, fingerprint and condition must still match");
  }
  if(model.thesisTests?.some(test=>!binding||!sameThesisIdentity(test.originalThesisIdentity,binding)))throw new ResearchContextError(409,"TEST_THESIS_IDENTITY_DRIFT","each test must retain the explicitly selected original report condition identity");
  if(model.thesisRevision){
    const revision=model.thesisRevision;
    if(!binding||!sameThesisIdentity(revision.previous,binding))throw new ResearchContextError(409,"REVISION_BINDING_DRIFT","revision must preserve the selected original Thesis");
    if(revision.status==="OWNER_CONFIRMED" && (revision.actor!==actor.actorId || !revision.confirmedAt || Date.parse(revision.confirmedAt)>now.getTime()))throw new ResearchContextError(400,"REVISION_CONFIRMATION_REQUIRED","explicit actor and confirmation timestamp required");
    if(revision.status==="DRAFT"&&(revision.actor!==null||revision.confirmedAt!==null))throw new ResearchContextError(400,"DRAFT_CONFIRMATION_CONFLICT","draft cannot claim confirmation");
  }
  if(model.thesisOwnerAction){const action=model.thesisOwnerAction;
    if(!binding||!sameThesisIdentity(action.originalThesisIdentity,binding)||action.actor!==actor.actorId||Date.parse(action.confirmedAt)>now.getTime())throw new ResearchContextError(409,"THESIS_ACTION_BINDING_DRIFT","Owner action must bind the current original Thesis and actor");
    if(action.action==="REVISE_THESIS"?!action.newThesis?.trim():action.newThesis!==null)throw new ResearchContextError(400,"INVALID_THESIS_ACTION","only an explicit revision may introduce new Thesis text");
  }
}

export type ThesisWriteIntent = "NONE" | "OWNER_ACTION" | {kind:"INITIAL_FORMATION"; selectedBinding:ExplicitThesisBinding; requestFingerprint:string};
function writeFingerprint(intent:ThesisWriteIntent,actor:AuthenticatedResearchActor,membershipId:string,request:Record<string,unknown>):string {
  return typeof intent==="object"?intent.requestFingerprint:requestFingerprint("research_operating_model",{actor,membershipId,request});
}
function parseOperatingModelRequest(body:unknown):Record<string,unknown> & {idempotencyKey:string} {
  if(!body||typeof body!=="object"||Array.isArray(body))throw new ResearchContextError(400,"INVALID_MODEL","invalid request");
  const r=body as Record<string,unknown>;
  if(Object.keys(r).sort().join()!==["baseContextId","membershipVersion","selectedSymbol","operatingModel","idempotencyKey"].sort().join()||!validateOperatingModel(r.operatingModel).ok||typeof r.idempotencyKey!=="string"||!r.idempotencyKey.trim())throw new ResearchContextError(400,"INVALID_MODEL","invalid operating model or identity");
  return r as Record<string,unknown> & {idempotencyKey:string};
}
export async function saveOperatingModel(pool:Pool|PoolClient,membershipId:string,body:unknown,actor:AuthenticatedResearchActor,now=new Date(),intent:ThesisWriteIntent="NONE",sourceStore?:SourceSnapshotStoreOptions) {
  const r=parseOperatingModelRequest(body);
  const fingerprint=writeFingerprint(intent,actor,membershipId,r);
  const replay=await replayOperatingModel(pool,membershipId,r,actor,now,fingerprint);
  if(replay)return replay;
  const model=structuredClone(r.operatingModel as OperatingResearchModel);
  const context=await readResearchContextSnapshot(pool,membershipId,actor,now);
  const old=context.status==="available"?context.data:null;
  if((old?.id??null)!==r.baseContextId)throw new ResearchContextError(409,"CONTEXT_VERSION_CONFLICT","reload the current context before saving");
  assertFormalThesisContinuity(old?.operatingModel,model,intent);

  const facts=await readResearchFundamentals(pool,membershipId,actor,now,undefined,sourceStore);
  if(facts.membershipVersion!==r.membershipVersion||facts.symbol!==r.selectedSymbol)throw new ResearchContextError(409,"MODEL_IDENTITY_DRIFT","membership or symbol changed");
  assertCurrentContext(old);
  if(periodCarryForwardViolation(model,old?.operatingModel))throw new ResearchContextError(422,"SCENARIO_PERIOD_ASSUMPTION_DRIFT","changed forecast period requires explicitly re-entered assumptions and renewed shares confirmation");
  stampRevision(model,old?.operatingModel,actor,now);
  const asOf=now.toISOString();
  const provenance={sourceType:"owner_manual_input",sourceVersion:"operating-model-v1",capturedAt:asOf,classification:"user_provided" as const};
  const request:CreateResearchContextRequest={baseContextId:old?.id??null,membershipVersion:facts.membershipVersion,selectedSymbol:facts.symbol,industry:old?.industry??"待补充行业研究",selectedFacts:old?.selectedFacts??[],peerFacts:old?.peerFacts??[],peers:old?.peers??[],macroDrivers:old?.macroDrivers??[],industryDrivers:old?.industryDrivers??[],unknowns:old?.unknowns??["情景为 Owner 研究草稿，不修改原报告或正式判断"],provenance,asOf,cutoffAt:asOf,validUntil:old?.validUntil??new Date(now.getTime()+30*86400000).toISOString(),idempotencyKey:r.idempotencyKey,operatingModel:model,operatingKpis:old?.operatingKpis??[]};
  return createResearchContextSnapshot(pool,membershipId,request,actor,now,fingerprint,sourceStore);
}

function assertFormalThesisContinuity(previous:OperatingResearchModel|undefined,model:OperatingResearchModel,intent:ThesisWriteIntent):void {
  if(previous?.thesisBinding&&(!model.thesisBinding||!sameThesisIdentity(previous.thesisBinding,model.thesisBinding)))
    throw new ResearchContextError(409,"FORMAL_THESIS_ALREADY_BOUND","use the formal Thesis revision flow");
  if(typeof intent==="object"){
    if(previous?.thesisBinding||!model.thesisBinding||!sameThesisIdentity(model.thesisBinding,intent.selectedBinding))
      throw new ResearchContextError(409,"FORMAL_THESIS_ALREADY_BOUND","initial formation requires the exact selected option and an unbound Thesis");
  }else if(intent==="NONE"&&!previous?.thesisBinding&&model.thesisBinding){
    throw new ResearchContextError(409,"FORMAL_THESIS_FORMATION_REQUIRED","confirm the formal Thesis on the Thesis Formation page");
  }else if(intent==="OWNER_ACTION"&&!previous?.thesisBinding){
    throw new ResearchContextError(409,"FORMAL_THESIS_FORMATION_REQUIRED","a formal Thesis must already exist");
  }
  if(intent!=="OWNER_ACTION"&&operatingModelFingerprint(previous?.thesisOwnerAction??null)!==operatingModelFingerprint(model.thesisOwnerAction??null))
    throw new ResearchContextError(409,"FORMAL_THESIS_ACTION_REQUIRED","use the formal Thesis Owner action flow");
}

export function periodCarryForwardViolation(next:OperatingResearchModel,previous:OperatingResearchModel|undefined):boolean {
  if(!previous)return false;
  const oldBase=previous.scenarios.find(s=>s.name==="base"),newBase=next.scenarios.find(s=>s.name==="base");
  if(!oldBase||!newBase||JSON.stringify(oldBase.period)===JSON.stringify(newBase.period))return false;
  if(previous.sharesValueId===next.sharesValueId&&next.sharesReferenceConfirmed)return true;
  return next.scenarios.some((s,index)=>Object.entries(s.inputs).some(([key,input])=>{const old=previous.scenarios[index]?.inputs[key as keyof typeof s.inputs];return input.origin!=="unknown"&&old?.origin===input.origin&&old.value===input.value&&old.note===input.note&&old.sourceValueId===input.sourceValueId;}));
}

function assertCurrentContext(old: {currentness:{status:string}} | null):void { if(old?.currentness.status !== undefined && old.currentness.status !== "current")throw new ResearchContextError(409,"STALE_CONTEXT","refresh the research evidence before updating a stale context"); }

async function replayOperatingModel(pool:Pool|PoolClient,membershipId:string,r:Record<string,unknown>,actor:AuthenticatedResearchActor,now:Date,fingerprint:string){
  const replay=await findByIdempotency(pool,actor,String(r.idempotencyKey));
  if(replay){
    const member=await readCandidateMembershipById(pool,actor,membershipId);
    if(!member || member.symbol!==r.selectedSymbol || Number(member.version)!==r.membershipVersion || member.state!=="tracked")throw new ResearchContextError(409,"MODEL_IDENTITY_DRIFT","membership changed before replay");
    if(replay.request_fingerprint!==fingerprint)throw new ResearchContextError(409,"IDEMPOTENCY_CONFLICT","idempotency key belongs to different model content");
    return writeEnvelope(rowToResearchContextSnapshot(replay,now),actor,"Operating model write replayed.");
  }
  return null;
}

function stampRevision(model:OperatingResearchModel,old:OperatingResearchModel|undefined,actor:AuthenticatedResearchActor,now:Date):void {
  if(model.thesisRevision?.status==="OWNER_CONFIRMED"&&JSON.stringify(model.thesisRevision)!==JSON.stringify(old?.thesisRevision)){
    model.thesisRevision.actor=actor.actorId;model.thesisRevision.confirmedAt=now.toISOString();
  }
  if(model.thesisRevision?.status==="DRAFT"){model.thesisRevision.actor=null;model.thesisRevision.confirmedAt=null;}
}

export function assertOwnerFixtureIsolation(model:OperatingResearchModel,actor:AuthenticatedResearchActor):void {
  if(JSON.stringify(model).includes("TEST FIXTURE ONLY")&&!actor.actorId.startsWith("test-"))throw new ResearchContextError(422,"FIXTURE_ACTOR_REQUIRED","test fixture inputs require an isolated test actor; Owner current context is protected");
}
