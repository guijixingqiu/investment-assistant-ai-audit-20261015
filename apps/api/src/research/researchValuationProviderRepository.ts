import {createHash} from "node:crypto";
import type {Pool,PoolClient} from "pg";
import {FUTU_VALUATION_SOURCE,validFutuValuationBridge,
  type CreateFutuValuationCaptureRequest,type FutuValuationBridge,type FutuValuationCapture}
  from "../../../../packages/contracts/src/researchValuationProvider.js";
import type {FutuValuationProvider} from "../market/futuValuationProvider.js";
import {readCandidateMembershipById} from "./candidateMembershipPersistence.js";
import {readResearchRawBytes,storeResearchRawBytes} from "./researchDocumentCas.js";
import {CandidateMembershipNotFoundError,CandidateMembershipVersionConflictError,IdempotencyConflictError,
  type AuthenticatedResearchActor} from "./domain.js";
import {requestFingerprint} from "./deepResearchGate.js";

type Reader=Pick<Pool|PoolClient,"query">;
type Store={repositoryRoot:string;rawStoreRoot?:string|null};
type Row={id:string;candidate_membership_id:string;captured_membership_version:number;actor_type:string;actor_id:string;
  symbol:string;valuation_type:"PE"|"PB";interval_type:"YEAR_5";captured_at:Date|string;
  provider_updated_at:Date|string;raw_sha256:string;byte_length:number;current_value:number;
  historical_average:number;historical_percentile:number;historical_count:number;
  first_historical_date_text:string;last_historical_date_text:string;request_fingerprint:string};
const sha=(value:Buffer)=>createHash("sha256").update(value).digest("hex");
const iso=(value:Date|string)=>new Date(value).toISOString();

export async function captureFutuValuation(pool:Pool,membershipId:string,request:CreateFutuValuationCaptureRequest,
  actor:AuthenticatedResearchActor,provider:FutuValuationProvider,store:Store,now=new Date()):Promise<FutuValuationCapture>{
  const member=await readCandidateMembershipById(pool,actor,membershipId);
  if(!member||member.state!=="tracked"||actor.actorType!=="user")throw new CandidateMembershipNotFoundError();
  if(Number(member.version)!==request.membershipVersion)throw new CandidateMembershipVersionConflictError();
  const fingerprint=requestFingerprint("futu_valuation_capture",{actor,membershipId,request});
  const prior=await readReplay(pool,actor,request.idempotencyKey);
  if(prior){if(prior.request_fingerprint!==fingerprint)throw new IdempotencyConflictError("valuation capture key has different semantics");
    return readFutuValuationCapture(pool,membershipId,prior.id,actor,store);}
  const {bytes,data}=await provider.read(member.symbol,request.valuationType);
  await storeResearchRawBytes(store.rawStoreRoot,store.repositoryRoot,sha(bytes),bytes);
  const client=await pool.connect();
  try{
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))",[`futu-valuation:${actor.actorId}:${request.idempotencyKey}`]);
    const replay=await readReplay(client,actor,request.idempotencyKey);
    if(replay){if(replay.request_fingerprint!==fingerprint)throw new IdempotencyConflictError("valuation capture key has different semantics");
      await client.query("commit");return readFutuValuationCapture(pool,membershipId,replay.id,actor,store);}
    const current=await readCandidateMembershipById(client,actor,membershipId);
    if(!current||current.state!=="tracked"||current.symbol!==member.symbol
      ||Number(current.version)!==request.membershipVersion)throw new CandidateMembershipVersionConflictError();
    const items=data.data.trend.historical_items;
    const inserted=await client.query<{id:string}>(`insert into research_futu_valuation_captures
      (candidate_membership_id,captured_membership_version,actor_type,actor_id,symbol,valuation_type,interval_type,
       captured_at,provider_updated_at,raw_sha256,byte_length,current_value,historical_average,historical_percentile,
       historical_count,first_historical_date,last_historical_date,idempotency_key,request_fingerprint)
      values($1,$2,$3,$4,$5,$6,'YEAR_5',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      returning id::text`,[membershipId,request.membershipVersion,actor.actorType,actor.actorId,member.symbol,
      request.valuationType,data.captured_at,new Date(data.data.last_update_time*1000),sha(bytes),bytes.length,
      data.data.trend.current_value,data.data.trend.average_value,data.data.trend.valuation_percentile,
      items.length,items[0]!.time_str,items.at(-1)!.time_str,request.idempotencyKey,fingerprint]);
    await client.query("commit");
    return readFutuValuationCapture(pool,membershipId,inserted.rows[0]!.id,actor,store);
  }catch(error){await client.query("rollback");throw error;}
  finally{client.release();}
}

async function readReplay(client:Reader,actor:AuthenticatedResearchActor,key:string):Promise<Pick<Row,"id"|"request_fingerprint">|null>{
  return (await client.query<Pick<Row,"id"|"request_fingerprint">>(`select id::text,request_fingerprint from research_futu_valuation_captures
    where actor_type=$1 and actor_id=$2 and idempotency_key=$3`,[actor.actorType,actor.actorId,key])).rows[0]??null;
}

export async function readFutuValuationOriginal(client:Reader,membershipId:string,captureId:string,
  actor:AuthenticatedResearchActor,store:Store):Promise<{capture:FutuValuationCapture;data:FutuValuationBridge;bytes:Buffer}>{
  const row=(await client.query<Row>(`select v.*,v.first_historical_date::text as first_historical_date_text,
    v.last_historical_date::text as last_historical_date_text from research_futu_valuation_captures v
    join candidate_memberships m on m.id=v.candidate_membership_id
    where v.id=$1 and v.candidate_membership_id=$2 and v.actor_type=$3 and v.actor_id=$4
      and m.actor_type=$3 and m.actor_id=$4 and m.symbol=v.symbol`,
    [captureId,membershipId,actor.actorType,actor.actorId])).rows[0];
  if(!row)throw new CandidateMembershipNotFoundError();
  const bytes=await readResearchRawBytes(store.rawStoreRoot,store.repositoryRoot,row.raw_sha256,Number(row.byte_length));
  let data:unknown;
  try{data=JSON.parse(bytes.toString("utf8"));}catch{throw new Error("saved valuation source is not JSON");}
  if(!validFutuValuationBridge(data,row.symbol,row.valuation_type)
    ||data.interval_type!==row.interval_type||iso(data.captured_at)!==iso(row.captured_at)
    ||new Date(data.data.last_update_time*1000).getTime()!==new Date(row.provider_updated_at).getTime()
    ||data.data.trend.current_value!==Number(row.current_value)
    ||data.data.trend.average_value!==Number(row.historical_average)
    ||data.data.trend.valuation_percentile!==Number(row.historical_percentile)
    ||data.data.trend.historical_items.length!==Number(row.historical_count)
    ||data.data.trend.historical_items[0]?.time_str!==row.first_historical_date_text
    ||data.data.trend.historical_items.at(-1)?.time_str!==row.last_historical_date_text)
    throw new Error("saved valuation original differs from capture metadata");
  return {capture:mapRow(row,"available"),data,bytes};
}

export async function readFutuValuationCapture(client:Reader,membershipId:string,captureId:string,
  actor:AuthenticatedResearchActor,store:Store):Promise<FutuValuationCapture>{
  return (await readFutuValuationOriginal(client,membershipId,captureId,actor,store)).capture;
}

export async function listFutuValuationCaptures(client:Reader,membershipId:string,actor:AuthenticatedResearchActor,
  store:Store):Promise<FutuValuationCapture[]>{
  const rows=(await client.query<Row>(`select v.*,v.first_historical_date::text as first_historical_date_text,
    v.last_historical_date::text as last_historical_date_text from research_futu_valuation_captures v
    join candidate_memberships m on m.id=v.candidate_membership_id
    where v.candidate_membership_id=$1 and v.actor_type=$2 and v.actor_id=$3
      and m.actor_type=$2 and m.actor_id=$3 and m.symbol=v.symbol
    order by v.captured_at desc,v.id desc limit 20`,[membershipId,actor.actorType,actor.actorId])).rows;
  return Promise.all(rows.map(async row=>{
    try{return (await readFutuValuationOriginal(client,membershipId,row.id,actor,store)).capture;}
    catch{return mapRow(row,"unavailable");}
  }));
}

function mapRow(row:Row,originalAvailability:FutuValuationCapture["originalAvailability"]):FutuValuationCapture{
  return {id:String(row.id),membershipId:String(row.candidate_membership_id),
    membershipVersion:Number(row.captured_membership_version),symbol:row.symbol,
    valuationType:row.valuation_type,intervalType:row.interval_type,
    capturedAt:iso(row.captured_at),providerUpdatedAt:iso(row.provider_updated_at),
    rawSha256:row.raw_sha256,byteLength:Number(row.byte_length),currentValue:Number(row.current_value),
    historicalAverage:Number(row.historical_average),historicalPercentile:Number(row.historical_percentile),
    historicalCount:Number(row.historical_count),firstHistoricalDate:row.first_historical_date_text,
    lastHistoricalDate:row.last_historical_date_text,originalAvailability};
}
