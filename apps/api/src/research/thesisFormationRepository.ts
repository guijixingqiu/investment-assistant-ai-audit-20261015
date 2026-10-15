import type {Pool,PoolClient} from "pg";
import type {SourceSnapshotStoreOptions} from "./researchSourceSnapshotRepository.js";
import type {AuthenticatedResearchActor} from "./domain.js";
import {findCandidateMembershipByIdForUpdate,readCandidateMembershipById} from "./candidateMembershipPersistence.js";
import {ResearchContextError,readResearchContextSnapshot,findByIdempotency,rowToResearchContextSnapshot,writeEnvelope} from "./researchContextRepository.js";
import {requestFingerprint} from "./deepResearchGate.js";
import {readDeepResearchWorkspace} from "./deepResearchReadRepository.js";
import {saveOperatingModel} from "./researchOperatingModelRepository.js";
import {emptyOperatingModel,type ExplicitThesisBinding} from "../../../../packages/contracts/src/researchOperatingModel.js";
import {sameThesisIdentity} from "../../../../packages/contracts/src/researchOperatingReasoning.js";
import {projectThesisFormation,type ThesisFormationProjection} from "../../../../packages/contracts/src/thesisFormation.js";

type Reader=Pick<Pool|PoolClient,"query">;
async function currentProjection(reader:Reader,id:string,actor:AuthenticatedResearchActor,now:Date,sourceStore?:SourceSnapshotStoreOptions):Promise<ThesisFormationProjection>{
  const member=await readCandidateMembershipById(reader,actor,id);
  if(!member||member.state!=="tracked")throw new ResearchContextError(409,"MEMBERSHIP_UNAVAILABLE","tracked membership required");
  const workspace=await readDeepResearchWorkspace(reader,id,actor,now,{accountScopeId:null,currentPortfolioEnabled:false,currentPortfolioMaxAgeSeconds:300,sourceStore});
  const context=await readResearchContextSnapshot(reader,id,actor,now);
  if(context.status==="unavailable")throw new ResearchContextError(503,"THESIS_FORMATION_UNAVAILABLE","current research context cannot be verified");
  const projection=projectThesisFormation(workspace,context.data?.id??null,context.data?.operatingModel??null,now,actor.actorType);
  if(projection.symbol!==member.symbol||projection.membershipVersion!==Number(member.version)||projection.membershipId!==id||workspace.requestedActorId!==actor.actorId)
    throw new ResearchContextError(409,"THESIS_FORMATION_DRIFT","research identity changed; reload");
  return projection;
}
export async function readThesisFormation(pool:Pool,id:string,actor:AuthenticatedResearchActor,now=new Date(),sourceStore?:SourceSnapshotStoreOptions):Promise<ThesisFormationProjection>{
  const client=await pool.connect();
  try{
    await client.query("begin isolation level repeatable read read only");
    const projection=await currentProjection(client,id,actor,now,sourceStore);
    await client.query("commit");
    return projection;
  }catch(error){await client.query("rollback");throw error;}finally{client.release();}
}
interface ConfirmRequest {membershipVersion:number;selectedSymbol:string;baseContextId:string|null;projectionFingerprint:string;option:ExplicitThesisBinding;confirmed:true;idempotencyKey:string}
function parseRequest(body:unknown):ConfirmRequest{
  if(!body||typeof body!=="object"||Array.isArray(body))throw new ResearchContextError(400,"INVALID_THESIS_FORMATION","exact confirmed option required");
  const r=body as Record<string,unknown>;
  if(Object.keys(r).sort().join()!==["membershipVersion","selectedSymbol","baseContextId","projectionFingerprint","option","confirmed","idempotencyKey"].sort().join()||
    !Number.isSafeInteger(r.membershipVersion)||typeof r.selectedSymbol!=="string"||!(r.baseContextId===null||typeof r.baseContextId==="string")||
    typeof r.projectionFingerprint!=="string"||r.confirmed!==true||typeof r.idempotencyKey!=="string"||r.idempotencyKey.length<8||
    !r.option||typeof r.option!=="object"||Array.isArray(r.option))
    throw new ResearchContextError(400,"INVALID_THESIS_FORMATION","exact confirmed option required");
  return r as unknown as ConfirmRequest;
}
export async function confirmThesisFormation(pool:Pool,id:string,actor:AuthenticatedResearchActor,body:unknown,now=new Date(),sourceStore?:SourceSnapshotStoreOptions){
  if(actor.actorType!=="user")throw new ResearchContextError(400,"OWNER_ACTION_REQUIRED","explicit Owner research authorization required");
  const r=parseRequest(body),client=await pool.connect();
  try{
    await client.query("begin");
    const member=await findCandidateMembershipByIdForUpdate(client,actor,id);
    const fingerprint=requestFingerprint("thesis_formation_confirm",{actor,membershipId:id,request:r});
    const replay=await findByIdempotency(client,actor,r.idempotencyKey);
    if(replay){
      const writtenBinding=(replay.context_payload as {operatingModel?:{thesisBinding?:ExplicitThesisBinding}}).operatingModel?.thesisBinding;
      if(replay.request_fingerprint!==fingerprint||replay.candidate_membership_id!==id||Number(replay.captured_membership_version)!==r.membershipVersion||replay.selected_symbol!==r.selectedSymbol||!writtenBinding||!sameThesisIdentity(writtenBinding,r.option))
        throw new ResearchContextError(409,"IDEMPOTENCY_CONFLICT","key belongs to another Thesis formation request");
      const result=writeEnvelope(rowToResearchContextSnapshot(replay,now),actor,"Formal Thesis confirmation replayed.");
      await client.query("commit");
      return result;
    }
    if(!member||member.state!=="tracked"||Number(member.version)!==r.membershipVersion||member.symbol!==r.selectedSymbol)
      throw new ResearchContextError(409,"THESIS_FORMATION_DRIFT","membership or symbol changed; reload");
    const projection=await currentProjection(client,id,actor,now,sourceStore);
    if(projection.status==="ENDED_REQUIRES_NEW_LINEAGE")throw new ResearchContextError(409,"ENDED_THESIS_REQUIRES_NEW_LINEAGE","use explicit REVISE_THESIS to start a new lineage");
    if(projection.status==="BOUND")throw new ResearchContextError(409,"FORMAL_THESIS_ALREADY_BOUND","use the formal Thesis revision flow");
    if(projection.status!=="READY_TO_SELECT"||projection.contextId!==r.baseContextId||projection.projectionFingerprint!==r.projectionFingerprint)
      throw new ResearchContextError(409,"THESIS_FORMATION_DRIFT","research or context changed; reload");
    const selected=projection.options.find(option=>sameThesisIdentity(option.binding,r.option));
    if(!selected)throw new ResearchContextError(409,"THESIS_FORMATION_DRIFT","report option changed; reload");
    const context=await readResearchContextSnapshot(client,id,actor,now);
    if(context.status==="unavailable"||(context.data?.id??null)!==r.baseContextId||context.data?.operatingModel?.thesisBinding)
      throw new ResearchContextError(409,"THESIS_FORMATION_DRIFT","context changed; reload");
    const model=structuredClone(context.data?.operatingModel??emptyOperatingModel(now.getUTCFullYear()));
    model.thesisBinding=selected.binding;
    const write=await saveOperatingModel(client,id,{baseContextId:r.baseContextId,membershipVersion:r.membershipVersion,selectedSymbol:r.selectedSymbol,operatingModel:model,idempotencyKey:r.idempotencyKey},actor,now,{kind:"INITIAL_FORMATION",selectedBinding:selected.binding,requestFingerprint:fingerprint},sourceStore);
    await client.query("commit");
    return write;
  }catch(error){
    await client.query("rollback");
    if((error as {code?:string}).code==="40001")throw new ResearchContextError(409,"THESIS_FORMATION_DRIFT","research changed during confirmation; reload");
    throw error;
  }finally{client.release();}
}
