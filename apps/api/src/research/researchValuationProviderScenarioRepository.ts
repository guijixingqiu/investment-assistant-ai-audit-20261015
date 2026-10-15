import type {Pool,PoolClient} from "pg";
import {RESEARCH_VALUATION_SCENARIOS_SCHEMA_VERSION,type ResearchProviderValuationScenarioSetData}
  from "../../../../packages/contracts/src/researchValuationScenarios.js";
import {validateAnnualValuationScenarioInput} from "../../../../packages/contracts/src/annualValuationQuantWorkbench.js";
import type {CreateFutuProviderValuationScenarioRequest,FutuProviderValuationBasis}
  from "../../../../packages/contracts/src/researchValuationProvider.js";
import type {ResearchWriteEnvelope} from "../../../../packages/contracts/src/research.js";
import {canonicalJson} from "../../../../packages/contracts/src/decisionContextBrowser.js";
import {readCandidateMembershipById} from "./candidateMembershipPersistence.js";
import {readFutuProviderValuationPreview} from "./researchValuationProviderBasis.js";
import {valuationCalculation} from "./researchValuationScenarioWriteRepository.js";
import {assertCandidateMembershipWriteBinding,sameBoundResearchWriteReplay} from "./researchWriteBinding.js";
import {requestFingerprint} from "./deepResearchGate.js";
import {actorRequest,findAuditByIdempotencyKey,insertWriteAudit,upsertStock,writeEnvelope} from "./writePersistence.js";
import {CandidateMembershipNotFoundError,IdempotencyConflictError,ResearchValuationScenarioError,
  type AuthenticatedResearchActor} from "./domain.js";

type Reader=Pick<Pool|PoolClient,"query">;
type Store={repositoryRoot:string;rawStoreRoot?:string|null};
type Row={id:string;candidate_membership_id:string;captured_membership_version:number;revision:number;
  replaces_scenario_set_id:string|null;assumption_payload:ResearchProviderValuationScenarioSetData["assumptions"]["values"];
  calculation_payload:ResearchProviderValuationScenarioSetData["calculation"];
  provider_basis:FutuProviderValuationBasis;created_at:Date|string;scenario_replaced:boolean;
  symbol:string;material_deleted:boolean;material_replaced:boolean;material_valid_until:Date|string;
  material_revision:number;material_content_fingerprint:string};

export async function readProviderValuationScenarioSets(client:Reader,membershipId:string,
  actor:AuthenticatedResearchActor,now=new Date(),store?:Store):Promise<ResearchProviderValuationScenarioSetData[]>{
  const member=await readCandidateMembershipById(client,actor,membershipId);
  if(!member)throw new CandidateMembershipNotFoundError();
  const rows=(await client.query<Row>(`${selection()} where vs.candidate_membership_id=$1
    and vs.basis_kind='provider' and cm.actor_type=$2 and cm.actor_id=$3
    order by vs.created_at desc,vs.id desc`,[membershipId,actor.actorType,actor.actorId])).rows;
  return Promise.all(rows.map(row=>mapRow(client,row,Number(member.version),member.state,actor,now,store)));
}

export async function readProviderValuationScenarioById(client:Reader,membershipId:string,id:string,
  actor:AuthenticatedResearchActor,now=new Date(),store?:Store):Promise<ResearchProviderValuationScenarioSetData|null>{
  const member=await readCandidateMembershipById(client,actor,membershipId);
  if(!member)throw new CandidateMembershipNotFoundError();
  const row=(await client.query<Row>(`${selection()} where vs.id=$1 and vs.candidate_membership_id=$2
    and vs.basis_kind='provider' and cm.actor_type=$3 and cm.actor_id=$4 limit 1`,
    [id,membershipId,actor.actorType,actor.actorId])).rows[0];
  return row?mapRow(client,row,Number(member.version),member.state,actor,now,store):null;
}

export async function createProviderValuationScenario(pool:Pool,membershipId:string,
  request:CreateFutuProviderValuationScenarioRequest,actor:AuthenticatedResearchActor,
  store:Store,now=new Date()):Promise<ResearchWriteEnvelope<ResearchProviderValuationScenarioSetData>>{
  const validation=validateAnnualValuationScenarioInput(request.assumptions);
  if(!validation.ok||request.assumptions.methodId!=="discounted_forward_metric_multiple_user_scenario"
    ||!request.assumptions.metricCurrency)
    throw new ResearchValuationScenarioError(422,"ASSUMPTIONS_INVALID","provider scenario requires a complete Owner-edited PE scenario");
  const fingerprint=requestFingerprint("research_provider_valuation_scenario_create",{actor,membershipId,request});
  const auditRequest=actorRequest(actor,request.idempotencyKey);
  const client=await pool.connect();
  try{
    await client.query("begin");
    const replay=await findAuditByIdempotencyKey<ResearchProviderValuationScenarioSetData>(client,
      request.idempotencyKey,"research_valuation_scenario_created");
    if(replay){
      // A committed request remains readable after the member version changes; this is no new write.
      if(!await readCandidateMembershipById(client,actor,membershipId))throw new CandidateMembershipNotFoundError();
      if(!sameBoundResearchWriteReplay(replay,actor,{...request,membershipId},fingerprint))
        throw new IdempotencyConflictError("provider valuation key has different semantics");
      await client.query("commit");return replay.envelope;
    }
    const membership=await assertCandidateMembershipWriteBinding(client,actor,{membershipId,membershipVersion:request.membershipVersion});
    if(membership.symbol!==request.symbol)throw new ResearchValuationScenarioError(409,"SYMBOL_CONFLICT","provider scenario member changed");
    const preview=await readFutuProviderValuationPreview(client,membershipId,request.financialCaptureId,
      request.annualPeriodEnd,request.epsBasis,request.valuationCaptureId,request.sourceMaterialId,actor,store);
    if(preview.sourceFingerprint!==request.proposalFingerprint||request.assumptions.metricCurrency!==preview.proposed.metricCurrency)
      throw new ResearchValuationScenarioError(409,"PROVIDER_SOURCE_CHANGED","provider source or currency changed before Owner confirmation");
    const previous=request.replacesScenarioSetId===null?null:
      (await client.query<Row>(`${selection()} where vs.id=$1 and vs.candidate_membership_id=$2
        and vs.basis_kind='provider' and cm.actor_type=$3 and cm.actor_id=$4 for update of vs`,
        [request.replacesScenarioSetId,membershipId,actor.actorType,actor.actorId])).rows[0];
    if(request.replacesScenarioSetId!==null&&(!previous||previous.scenario_replaced
      ||canonicalJson(previous.provider_basis)!==canonicalJson(preview.basis)))
      throw new ResearchValuationScenarioError(409,"PROVIDER_REVISION_CONFLICT","provider scenario revision must retain the same current source basis");
    const calculation=valuationCalculation(request.assumptions);
    // The shared grid formula applies, but the issuer-anchor applicability claim does not.
    delete calculation.method.applicability;
    const revision=previous?Number(previous.revision)+1:1;
    const inserted=await client.query<{id:string}>(`insert into research_valuation_scenario_sets
      (candidate_membership_id,captured_membership_version,anchor_value_id,replaces_scenario_set_id,revision,
       assumption_payload,calculation_version,calculation_payload,created_at,basis_kind,
       provider_financial_capture_id,provider_valuation_capture_id,provider_source_material_id,provider_basis)
      values($1,$2,null,$3,$4,$5::jsonb,$6,$7::jsonb,$8,'provider',$9,$10,$11,$12::jsonb) returning id::text`,
      [membershipId,request.membershipVersion,request.replacesScenarioSetId,revision,
        JSON.stringify(request.assumptions),calculation.method.calculationVersion,JSON.stringify(calculation),now,
        request.financialCaptureId,request.valuationCaptureId,request.sourceMaterialId,JSON.stringify(preview.basis)]);
    const data=await readProviderValuationScenarioById(client,membershipId,inserted.rows[0]!.id,actor,now,store);
    if(!data||!data.recomputable)throw new ResearchValuationScenarioError(503,"PROVIDER_READBACK_FAILED","provider scenario could not be read back");
    const stock=await upsertStock(client,"HK",request.symbol.slice(3),request.symbol,null);
    const auditAsOf=await insertWriteAudit(client,{eventType:"research_valuation_scenario_created",
      request:auditRequest,stock,targetTable:"research_valuation_scenario_sets",targetId:data.id,
      beforePayload:null,afterPayload:data,requestFingerprint:fingerprint,
      candidateMembershipId:membershipId,candidateMembershipVersion:request.membershipVersion});
    await client.query("commit");
    return writeEnvelope(auditRequest,data,"Owner-confirmed provider research valuation scenario created.",auditAsOf);
  }catch(error){await client.query("rollback");throw error;}
  finally{client.release();}
}

async function mapRow(client:Reader,row:Row,currentVersion:number,state:string,actor:AuthenticatedResearchActor,
  now:Date,store?:Store):Promise<ResearchProviderValuationScenarioSetData>{
  const basis=row.provider_basis,invalidatedBy:ResearchProviderValuationScenarioSetData["invalidatedBy"]=[];
  if(row.scenario_replaced)invalidatedBy.push("scenario_replaced");
  if(Number(row.captured_membership_version)!==currentVersion)invalidatedBy.push("membership_version_changed");
  if(state==="archived")invalidatedBy.push("membership_archived");
  if(row.material_deleted||row.material_replaced||new Date(row.material_valid_until).getTime()<=now.getTime()
    ||Number(row.material_revision)!==basis.sourceMaterialRevision
    ||row.material_content_fingerprint!==basis.sourceMaterialFingerprint)
    invalidatedBy.push("provider_material_changed");
  if(!store)invalidatedBy.push("provider_original_unavailable");
  else try{
    const preview=await readFutuProviderValuationPreview(client,String(row.candidate_membership_id),
      basis.eps.financialCaptureId,basis.eps.periodEnd,basis.eps.basis,
      basis.valuation.captureId,basis.sourceMaterialId,actor,store);
    if(canonicalJson(preview.basis)!==canonicalJson(basis))invalidatedBy.push("provider_original_unavailable");
  }catch{invalidatedBy.push("provider_original_unavailable");}
  return {id:String(row.id),membershipId:String(row.candidate_membership_id),
    membershipVersionAtWrite:Number(row.captured_membership_version),symbol:row.symbol,
    revision:Number(row.revision),replacesScenarioSetId:row.replaces_scenario_set_id?String(row.replaces_scenario_set_id):null,
    scenarioState:row.scenario_replaced?"replaced":"current",recomputable:invalidatedBy.length===0,invalidatedBy,
    basisKind:"provider",providerBasis:basis,
    assumptions:{authority:"owner",derivation:"provider_reference_owner_confirmed",values:row.assumption_payload},
    calculation:row.calculation_payload,safety:{advisoryOnly:true,forecast:false,recommendation:false,
      automaticSignal:false,createsOrder:false,callsBroker:false,mutatesOfficialPortfolio:false},
    createdAt:new Date(row.created_at).toISOString()};
}

function selection():string{return `select vs.id::text,vs.candidate_membership_id::text,
  vs.captured_membership_version,vs.revision,vs.replaces_scenario_set_id::text,vs.assumption_payload,
  vs.calculation_payload,vs.provider_basis,vs.created_at,cm.symbol,
  rm.deleted_at is not null as material_deleted,
  exists(select 1 from research_materials child where child.replaces_material_id=rm.id) as material_replaced,
  rm.valid_until as material_valid_until,rm.revision as material_revision,rm.content_fingerprint as material_content_fingerprint,
  exists(select 1 from research_valuation_scenario_sets child where child.replaces_scenario_set_id=vs.id) as scenario_replaced
  from research_valuation_scenario_sets vs join candidate_memberships cm on cm.id=vs.candidate_membership_id
  join research_materials rm on rm.id=vs.provider_source_material_id
  and vs.calculation_version <> '2026-10-12.discounted-fcff-to-common-equity.v2'`;
}
