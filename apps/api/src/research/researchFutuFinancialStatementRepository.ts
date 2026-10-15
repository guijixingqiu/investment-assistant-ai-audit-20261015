import {createHash} from "node:crypto";
import type {Pool, PoolClient} from "pg";
import {
  FUTU_FINANCIAL_STATEMENT_SOURCE,
  FUTU_FINANCIAL_PERIOD_CODE,
  FUTU_FINANCIAL_UNKNOWNS,
  FUTU_STATEMENT_CODE,
  FUTU_STATEMENT_TYPES,
  type CaptureFutuFinancialStatementsRequest,
  type FutuFinancialCaptureData,
  type FutuFinancialHistoryData,
  type FutuFinancialHistoryValue,
  type CreateFutuFinancialMaterialRequest,type FutuFinancialMaterialPreview,
  type FutuFinancialPageData,
  type FutuFinancialReportSummary,
  type FutuFinancialTableState,
  type FutuFinancialTableStates,
  type FutuStatementType
} from "../../../../packages/contracts/src/researchFutuFinancialStatement.js";
import type {FutuFinancialStatementsProvider} from "../market/futuFinancialStatementsProvider.js";
import {FutuFinancialPageError,validBridgePage} from "../market/futuFinancialStatementsProvider.js";
import {projectFutuFinancialHistoryValues} from "../../../../packages/contracts/src/researchFutuFinancialHistory.js";
import {observedFutuComparisonNotices} from "../../../../packages/contracts/src/researchFutuFinancialComparisonEvidence.js";
import {readCandidateMembershipById} from "./candidateMembershipPersistence.js";
import {CandidateMembershipNotFoundError, CandidateMembershipVersionConflictError,
  ResearchDocumentError, type AuthenticatedResearchActor} from "./domain.js";
import {readResearchRawBytes, storeResearchRawBytes, validatedRawStoreRoot} from "./researchDocumentCas.js";
import {assertCandidateMembershipWriteBinding} from "./researchWriteBinding.js";
import {createResearchMaterial} from "./deepResearchMaterialRepository.js";
import {canonicalJson} from "../../../../packages/contracts/src/decisionContextBrowser.js";

type Reader = Pick<Pool | PoolClient, "query">;
type Store = {repositoryRoot:string;rawStoreRoot?:string|null};

export function futuFinancialPeriodFingerprint(values:FutuFinancialHistoryValue[]):string {
  return sha(canonicalJson([...values].sort((a,b)=>a.metric.localeCompare(b.metric))));
}

export async function readFutuFinancialMaterialMatches(client:Reader,membershipId:string,actor:AuthenticatedResearchActor,
  sourceFingerprint:string,now=new Date()):Promise<FutuFinancialMaterialPreview["materials"]>{
  const rows=await client.query<{id:string;revision:number;content_fingerprint:string;source_version:string}>(`
    select rm.id::text,rm.revision,rm.content_fingerprint,rm.source_version from research_materials rm
    join evidence_items e on e.id=rm.evidence_item_id join candidate_memberships m on m.id=rm.candidate_membership_id
    where rm.candidate_membership_id=$1 and m.actor_type=$2 and m.actor_id=$3
      and e.source_type=$4 and e.raw_payload->'futuFinancialSource'->>'sourceFingerprint'=$5
      and (e.raw_payload->'futuFinancialSource'->>'membershipVersion')::int=m.version
      and rm.deleted_at is null and rm.valid_until>$6 and rm.claim_type='third_party_statement'
      and rm.verification_status='unverified' and not exists(select 1 from research_materials child where child.replaces_material_id=rm.id)
    order by rm.id limit 20`,[membershipId,actor.actorType,actor.actorId,FUTU_FINANCIAL_STATEMENT_SOURCE,sourceFingerprint,now]);
  return rows.rows.map(r=>({id:String(r.id),revision:Number(r.revision),contentFingerprint:r.content_fingerprint,sourceVersion:r.source_version}));
}

export async function readFutuFinancialMaterialPreview(client:Reader,membershipId:string,captureId:string,
  financialType:"ANNUAL"|"Q6",periodEnd:string,actor:AuthenticatedResearchActor,store:Store,now=new Date()):Promise<FutuFinancialMaterialPreview>{
  const member=await readCandidateMembershipById(client,actor,membershipId);
  if(!member||member.state!=="tracked")throw new CandidateMembershipNotFoundError();
  const capture=await readFutuFinancialCapture(client,membershipId,captureId,actor,store);
  if(capture.membershipVersion!==Number(member.version)||capture.symbol!==member.symbol)
    throw new CandidateMembershipVersionConflictError();
  const selection=financialType==="ANNUAL"?"annual":"half_year";
  if(capture.periodSelection!==selection)throw new FutuFinancialCaptureError(409,"CAPTURE_PERIOD_MISMATCH","请选择明确的年度或累计半年捕获。");
  const selected=capture.pages.filter(page=>page.reports.some(r=>r.periodEnd===periodEnd&&r.financialType===financialType));
  if(!selected.length||new Set(selected.map(p=>p.statementType)).size!==selected.length)
    throw new FutuFinancialCaptureError(409,"PERIOD_SELECTION_INVALID","所选期间不存在或同表有多个版本。");
  const values:FutuFinancialHistoryValue[]=[],pages:FutuFinancialMaterialPreview["source"]["pages"]=[];
  for(const page of selected){
    const original=await readFutuFinancialOriginal(client,membershipId,captureId,page.id,actor,store);
    const raw=JSON.parse(original.bytes.toString("utf8")) as import("../../../../packages/contracts/src/researchFutuFinancialStatement.js").FutuFinancialBridgePage;
    const report=page.reports.filter(r=>r.periodEnd===periodEnd&&r.financialType===financialType);
    if(report.length!==1)throw new FutuFinancialCaptureError(409,"PERIOD_SELECTION_INVALID","所选期间版本不唯一。");
    pages.push({pageId:page.id,statementType:page.statementType,rawSha256:page.rawSha256,reportSha256:report[0]!.reportSha256});
    values.push(...projectFutuFinancialHistoryValues(raw,selection,{captureId,pageId:page.id,rawSha256:page.rawSha256,
      capturedAt:page.capturedAt,reportSha256s:page.reports.map(r=>r.reportSha256)})
      .filter(v=>v.financialType===financialType&&v.periodEnd===periodEnd));
  }
  if(!values.length||new Set(values.map(v=>v.metric)).size!==values.length)
    throw new FutuFinancialCaptureError(409,"PERIOD_VALUES_UNAVAILABLE","所选原件没有唯一可使用的核心指标。");
  const gaps=FUTU_STATEMENT_TYPES.flatMap(type=>{
    const state=capture.tables[type];
    return state.status==="complete"?[]:[`${type}：${state.reasonCode??"部分取得"}；状态 ${state.status}，仅表示本次捕获范围。`];
  });
  const missingMetrics=([["revenue","营业总收入"],["profit_attributable_to_owners","归属母公司净利润"],
    ["operating_cash_flow","经营活动现金流量净额"],["total_assets","资产合计"],["total_liabilities","负债合计"]] as const)
    .filter(([metric])=>!values.some(value=>value.metric===metric)).map(([,name])=>name);
  if(missingMetrics.length)gaps.push(`所选期间缺少核心指标：${missingMetrics.join("、")}。`);
  if(new Set(values.map(v=>v.currencyCode)).size>1)gaps.push("所选期间含不同币种，不能合并金额。");
  for(const code of new Set(values.map(v=>v.currencyCode)))if(!["CNY","HKD","USD"].includes(code))
    gaps.push(`币种 ${code} 未支持量化结论；仅保留原值，不换算成人民币。`);
  const source={captureId,membershipId,membershipVersion:Number(member.version),symbol:member.symbol,capturedAt:capture.capturedAt,
    financialType,periodEnd,sourceFingerprint:futuFinancialPeriodFingerprint(values),pages,
    rows:values.map(({rawValue:_rawValue,source:_source,...row})=>row),gaps,
    amountUnit:"currency_base_unit" as const,amountUnitScale:1 as const,
    publicationTime:"UNKNOWN" as const,issuerOriginalVerification:"UNKNOWN" as const,restatementComparability:"UNKNOWN" as const};
  const title=`OpenD 提供商财务 · ${member.symbol} · ${periodEnd} ${financialType}`;
  const contentText=[title,"第三方声明，未核实；发行人原文、最新应披露期间与重述可比性未知。披露时间未知。",
    `OpenD 捕获时间：${capture.capturedAt}；捕获 #${captureId}，研究成员 #${membershipId} v${member.version}。`,
    ...values.map(v=>`${v.periodText}；${v.periodKind==="instant"?"期末时点":`${v.periodStart} 至`} ${v.periodEnd}；${v.displayName}：${v.rawValue} ${v.currencyCode}。金额单位为该币种基础单位（倍率1）；源表 ${v.statementType} 字段 ${v.fieldId}，原页 #${v.source.pageId}，原响应 SHA-256 ${v.source.rawSha256}，报告 SHA-256 ${v.source.reportSha256}。`),
    ...gaps.map(g=>`范围局限：${g}`)].join("\n");
  const summary=[`${title}；第三方声明、未核实；披露时间、发行人原文、最新应披露期间及重述可比性未知。`,
    ...values.map(v=>`${v.displayName}（${v.periodKind==="instant"?"期末时点":`${v.periodStart} 至`} ${v.periodEnd}）：${v.rawValue} ${v.currencyCode}，币种基础单位（倍率1）。`),
    ...gaps.map(g=>`范围局限：${g}`)].join("\n");
  return {source,values,title,contentText,summary,
    contentFingerprint:sha(contentText),sourceVersion:`opend:${captureId}:${financialType}:${periodEnd}:${source.sourceFingerprint.slice(0,16)}`,
    materials:await readFutuFinancialMaterialMatches(client,membershipId,actor,source.sourceFingerprint,now)};
}

export async function createFutuFinancialMaterial(pool:Pool,membershipId:string,captureId:string,
  request:CreateFutuFinancialMaterialRequest,actor:AuthenticatedResearchActor,store:Store,now=new Date()){
  const preview=await readFutuFinancialMaterialPreview(pool,membershipId,captureId,request.financialType,request.periodEnd,actor,store,now);
  if(preview.source.membershipVersion!==request.membershipVersion)throw new CandidateMembershipVersionConflictError();
  if(preview.source.sourceFingerprint!==request.sourceFingerprint)
    throw new FutuFinancialCaptureError(409,"MATERIAL_SOURCE_DRIFT","所选 OpenD 原件身份已变化，请重新核对。");
  if(Date.parse(request.validUntil)<=now.getTime())throw new FutuFinancialCaptureError(409,"MATERIAL_VALIDITY_EXPIRED","请选择未来的资料复核日期。");
  return createResearchMaterial(pool,"HK",preview.source.symbol.slice(3),{membershipId,membershipVersion:request.membershipVersion,
    title:preview.title,contentText:preview.contentText,sourceType:FUTU_FINANCIAL_STATEMENT_SOURCE,sourceUrl:null,publishedAt:null,
    claimType:"third_party_statement",verificationStatus:"unverified",rightsStatus:"user_provided",sourceVersion:preview.sourceVersion,
    validUntil:request.validUntil,summary:preview.summary,stance:"neutral",isRead:true,idempotencyKey:request.idempotencyKey},
    actor,now,null,preview.source);
}

type CaptureRow = {
  id:string;candidate_membership_id:string;captured_membership_version:number;actor_type:"user";actor_id:string;
  symbol:string;source_classification:typeof FUTU_FINANCIAL_STATEMENT_SOURCE;captured_at:Date|string;
  page_size:number;max_pages_per_table:number;table_states:FutuFinancialTableStates;
  requested_financial_type:5|7|null;
  idempotency_key:string;request_fingerprint:string;
};
type PageRow = {
  id:string;capture_id:string;statement_type:FutuStatementType;page_number:number;requested_cursor:string|null;
  next_cursor:string;captured_at:Date|string;raw_sha256:string;byte_length:number;
  report_summaries:FutuFinancialReportSummary[];
};
type PendingPage = Omit<FutuFinancialPageData,"id"|"captureId"|"originalAvailability"> & {bytes:Buffer};

const sha = (data:Buffer|string) => createHash("sha256").update(data).digest("hex");
const iso = (value:Date|string) => new Date(value).toISOString();
const deadlineMilliseconds = 45_000;

export class FutuFinancialCaptureError extends Error {
  constructor(readonly statusCode:number,readonly code:string,message:string){super(message);}
}

function emptyState():FutuFinancialTableState {
  return {status:"unavailable",reasonCode:"NO_PAGE",pageCount:0,reportCount:0,
    requestPaginationComplete:false,lastNextCursor:null,currentOriginalsAvailable:null};
}

function summaries(reports:Awaited<ReturnType<FutuFinancialStatementsProvider["readPage"]>>["data"]["report_list"]):FutuFinancialReportSummary[] {
  return reports.map(report=>({periodEnd:report.date_time_str,periodText:report.period_text,
    financialType:report.financial_type,fiscalYear:report.fiscal_year,currencyCode:report.currency_code,
    accountingStandards:report.accounting_standards,itemCount:report.item_list.length,
    reportSha256:sha(JSON.stringify(report))}));
}

async function collectTable(provider:FutuFinancialStatementsProvider,store:Store,symbol:string,
  statementType:FutuStatementType,pageSize:number,maxPages:number,deadline:number,financialType:5|7|null):Promise<{
    state:FutuFinancialTableState;pages:PendingPage[]
  }> {
  const state=emptyState(),pages:PendingPage[]=[];
  const seenCursors=new Set<string>(),seenReports=new Map<string,string>();
  let cursor:string|null=null,previousPeriod:string|null=null,currency:string|null=null;
  for(let pageNumber=1;pageNumber<=maxPages;pageNumber++){
    if(Date.now()>=deadline){state.reasonCode="CAPTURE_DEADLINE";break;}
    try{
      const fetched=await provider.readPage(symbol,statementType,pageSize,cursor,deadline-Date.now(),financialType);
      const reports=summaries(fetched.data.report_list);
      await storeResearchRawBytes(store.rawStoreRoot,store.repositoryRoot,sha(fetched.bytes),fetched.bytes);
      pages.push({statementType,pageNumber,requestedCursor:cursor,nextCursor:fetched.data.next_key,
        capturedAt:fetched.data.captured_at,rawSha256:sha(fetched.bytes),byteLength:fetched.bytes.length,
        reports,bytes:fetched.bytes});
      state.pageCount=pages.length;
      state.reportCount+=reports.length;
      state.lastNextCursor=fetched.data.next_key;
      state.currentOriginalsAvailable=true;
      state.status="partial";
      for(const report of reports){
        const identity=`${report.periodEnd}:${report.financialType}:${report.fiscalYear}`;
        const previous=seenReports.get(identity);
        if(previous && previous!==report.reportSha256){state.reasonCode="PERIOD_CONFLICT";break;}
        if(previous){state.reasonCode="DUPLICATE_PERIOD";break;}
        if(previousPeriod && report.periodEnd>previousPeriod){state.reasonCode="PERIOD_ORDER_INVALID";break;}
        if(currency && report.currencyCode!==currency){state.reasonCode="MIXED_CURRENCY";break;}
        seenReports.set(identity,report.reportSha256);
        previousPeriod=report.periodEnd;
        currency=report.currencyCode;
      }
      if(state.reasonCode && state.reasonCode!=="NO_PAGE") break;
      state.reasonCode=null;
      if(fetched.data.next_key==="-1"){
        state.requestPaginationComplete=true;
        state.status=state.reportCount>0?"complete":"unavailable";
        state.reasonCode=state.reportCount>0?null:"NO_REPORTS";
        break;
      }
      if(fetched.data.next_key===cursor || seenCursors.has(fetched.data.next_key)){
        state.reasonCode="CURSOR_LOOP";
        break;
      }
      seenCursors.add(fetched.data.next_key);
      cursor=fetched.data.next_key;
      if(pageNumber===maxPages)state.reasonCode="PAGE_LIMIT";
    }catch(error){
      state.reasonCode=error instanceof FutuFinancialPageError?error.code
        :error instanceof ResearchDocumentError?error.code:"PAGE_REQUEST_FAILED";
      break;
    }
  }
  if(state.pageCount===0)state.status="unavailable";
  else if(!state.requestPaginationComplete)state.status="partial";
  return {state,pages};
}

export async function captureFutuFinancialStatements(pool:Pool,membershipId:string,
  request:CaptureFutuFinancialStatementsRequest,actor:AuthenticatedResearchActor,
  provider:FutuFinancialStatementsProvider,store:Store,now=new Date()):Promise<FutuFinancialCaptureData>{
  if(actor.actorType!=="user")throw new FutuFinancialCaptureError(403,"USER_ACTOR_REQUIRED","explicit user actor required");
  const financialType=request.periodSelection?FUTU_FINANCIAL_PERIOD_CODE[request.periodSelection]:null;
  const fingerprint=sha(JSON.stringify({actor,membershipId,membershipVersion:request.membershipVersion,
    pageSize:request.pageSize,maxPagesPerTable:request.maxPagesPerTable,userRequested:request.userRequested,
    ...(request.periodSelection?{periodSelection:request.periodSelection}:{})}));
  const lockKey=`futu-financial:${actor.actorType}:${actor.actorId}:${request.idempotencyKey}`;
  const client=await pool.connect();
  let locked=false;
  try{
    await client.query("select pg_advisory_lock(hashtextextended($1,0))",[lockKey]);
    locked=true;
    const existing=(await client.query<CaptureRow>(`select * from research_futu_financial_statement_captures
      where actor_type=$1 and actor_id=$2 and idempotency_key=$3`,[actor.actorType,actor.actorId,request.idempotencyKey])).rows[0];
    if(existing){
      if(existing.request_fingerprint!==fingerprint || existing.candidate_membership_id!==membershipId)
        throw new FutuFinancialCaptureError(409,"CAPTURE_IDEMPOTENCY_CONFLICT","idempotency key binds another financial capture");
      return readFutuFinancialCapture(client,membershipId,String(existing.id),actor,store);
    }
    const member=await readCandidateMembershipById(client,actor,membershipId);
    if(!member || member.state!=="tracked")throw new CandidateMembershipNotFoundError();
    if(Number(member.version)!==request.membershipVersion)
      throw new CandidateMembershipVersionConflictError("stale membership version");
    await validatedRawStoreRoot(store.rawStoreRoot,store.repositoryRoot);
    const deadline=Date.now()+deadlineMilliseconds;
    const tables={} as FutuFinancialTableStates;
    const pages:PendingPage[]=[];
    for(const type of FUTU_STATEMENT_TYPES){
      const result=await collectTable(provider,store,member.symbol,type,request.pageSize,
        request.maxPagesPerTable,deadline,financialType);
      tables[type]=result.state;
      pages.push(...result.pages);
    }
    await client.query("begin");
    try{
      await assertCandidateMembershipWriteBinding(client,actor,{membershipId,membershipVersion:request.membershipVersion});
      const inserted=(await client.query<CaptureRow>(`insert into research_futu_financial_statement_captures
        (candidate_membership_id,captured_membership_version,actor_type,actor_id,symbol,source_classification,
         captured_at,page_size,max_pages_per_table,table_states,idempotency_key,request_fingerprint,requested_financial_type)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,[membershipId,request.membershipVersion,
        actor.actorType,actor.actorId,member.symbol,FUTU_FINANCIAL_STATEMENT_SOURCE,now,request.pageSize,
        request.maxPagesPerTable,JSON.stringify(tables),request.idempotencyKey,fingerprint,financialType])).rows[0]!;
      for(const page of pages){
        await client.query(`insert into research_futu_financial_statement_pages
          (capture_id,candidate_membership_id,captured_membership_version,actor_type,actor_id,statement_type,
           page_number,requested_cursor,next_cursor,captured_at,raw_sha256,byte_length,report_summaries)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[inserted.id,membershipId,request.membershipVersion,
          actor.actorType,actor.actorId,page.statementType,page.pageNumber,page.requestedCursor,
          page.nextCursor,page.capturedAt,page.rawSha256,page.byteLength,JSON.stringify(page.reports)]);
      }
      await client.query("commit");
      return readFutuFinancialCapture(client,membershipId,String(inserted.id),actor,store);
    }catch(error){await client.query("rollback");throw error;}
  }finally{
    if(locked)await client.query("select pg_advisory_unlock(hashtextextended($1,0))",[lockKey]);
    client.release();
  }
}

function pageData(row:PageRow,availability:FutuFinancialPageData["originalAvailability"]):FutuFinancialPageData {
  return {id:String(row.id),captureId:String(row.capture_id),statementType:row.statement_type,
    pageNumber:Number(row.page_number),requestedCursor:row.requested_cursor,nextCursor:row.next_cursor,
    capturedAt:iso(row.captured_at),rawSha256:row.raw_sha256,byteLength:Number(row.byte_length),
    reports:row.report_summaries,originalAvailability:availability};
}

async function originalAvailability(row:PageRow,store:Store):Promise<FutuFinancialPageData["originalAvailability"]>{
  try{
    await readResearchRawBytes(store.rawStoreRoot,store.repositoryRoot,row.raw_sha256,Number(row.byte_length));
    return "available";
  }catch(error){
    if(error instanceof ResearchDocumentError && error.code==="RAW_STORE_UNAVAILABLE")return "unknown";
    if(error instanceof ResearchDocumentError && ["RAW_CONTENT_MISSING","RAW_CONTENT_HASH_MISMATCH","RAW_STORE_INVALID"].includes(error.code))return "unavailable";
    throw error;
  }
}

function projectedTables(stored:FutuFinancialTableStates,pages:FutuFinancialPageData[]):FutuFinancialTableStates{
  const result={} as FutuFinancialTableStates;
  for(const type of FUTU_STATEMENT_TYPES){
    const state=stored[type];
    const selected=pages.filter(page=>page.statementType===type);
    if(!state || !["complete","partial","unavailable"].includes(state.status)
      || !Number.isSafeInteger(state.pageCount) || !Number.isSafeInteger(state.reportCount)
      || state.pageCount!==selected.length
      || state.reportCount!==selected.reduce((count,page)=>count+page.reports.length,0))
      throw new FutuFinancialCaptureError(503,"CAPTURE_STATE_INVALID","stored financial capture state is invalid");
    const originals=selected.map(page=>page.originalAvailability);
    result[type]={...state,currentOriginalsAvailable:originals.length===0?null
      :originals.includes("unavailable")?false:originals.includes("unknown")?null:true};
  }
  return result;
}

export async function readFutuFinancialCapture(client:Reader,membershipId:string,captureId:string,
  actor:AuthenticatedResearchActor,store:Store,verifyOriginals=true):Promise<FutuFinancialCaptureData>{
  const row=(await client.query<CaptureRow>(`select c.* from research_futu_financial_statement_captures c
    join candidate_memberships m on m.id=c.candidate_membership_id
    where c.id=$1 and c.candidate_membership_id=$2 and c.actor_type=$3 and c.actor_id=$4
      and m.actor_type=$3 and m.actor_id=$4 and m.symbol=c.symbol`,[captureId,membershipId,actor.actorType,actor.actorId])).rows[0];
  if(!row)throw new FutuFinancialCaptureError(404,"CAPTURE_NOT_FOUND","financial capture not found for this member and actor");
  const rows=(await client.query<PageRow>(`select * from research_futu_financial_statement_pages
    where capture_id=$1 and candidate_membership_id=$2 and actor_type=$3 and actor_id=$4
    order by statement_type,page_number`,[captureId,membershipId,actor.actorType,actor.actorId])).rows;
  const pages=await Promise.all(rows.map(async value=>pageData(value,
    verifyOriginals?await originalAvailability(value,store):"unknown")));
  return {id:String(row.id),membershipId:String(row.candidate_membership_id),
    membershipVersion:Number(row.captured_membership_version),actorType:row.actor_type,actorId:row.actor_id,
    symbol:row.symbol,sourceClassification:row.source_classification,capturedAt:iso(row.captured_at),
    pageSize:Number(row.page_size),maxPagesPerTable:Number(row.max_pages_per_table),
    periodSelection:row.requested_financial_type===7?"annual":row.requested_financial_type===5?"half_year":"legacy_default",
    tables:projectedTables(row.table_states,pages),pages,unknowns:FUTU_FINANCIAL_UNKNOWNS};
}

export async function listFutuFinancialCaptures(client:Reader,membershipId:string,
  actor:AuthenticatedResearchActor,store:Store):Promise<FutuFinancialCaptureData[]>{
  const rows=(await client.query<{id:string}>(`select c.id::text from research_futu_financial_statement_captures c
    join candidate_memberships m on m.id=c.candidate_membership_id
    where c.candidate_membership_id=$1 and c.actor_type=$2 and c.actor_id=$3
      and m.actor_type=$2 and m.actor_id=$3 and m.symbol=c.symbol
    order by c.captured_at desc,c.id desc limit 20`,[membershipId,actor.actorType,actor.actorId])).rows;
  return Promise.all(rows.map(row=>readFutuFinancialCapture(client,membershipId,row.id,actor,store,false)));
}

export async function readFutuFinancialOriginal(client:Reader,membershipId:string,captureId:string,
  pageId:string,actor:AuthenticatedResearchActor,store:Store):Promise<{page:FutuFinancialPageData;bytes:Buffer}>{
  const row=(await client.query<PageRow&{capture_symbol:string;capture_page_size:number;capture_financial_type:5|7|null}>(`select p.*,c.symbol as capture_symbol,c.page_size as capture_page_size,
    c.requested_financial_type as capture_financial_type from research_futu_financial_statement_pages p
    join research_futu_financial_statement_captures c on c.id=p.capture_id
    join candidate_memberships m on m.id=c.candidate_membership_id
    where p.id=$1 and p.capture_id=$2 and c.id=$2 and c.candidate_membership_id=$3
      and c.actor_type=$4 and c.actor_id=$5 and m.actor_type=$4 and m.actor_id=$5 and m.symbol=c.symbol`,
  [pageId,captureId,membershipId,actor.actorType,actor.actorId])).rows[0];
  if(!row)throw new FutuFinancialCaptureError(404,"PAGE_NOT_FOUND","financial page not found for this member and actor");
  const bytes=await readResearchRawBytes(store.rawStoreRoot,store.repositoryRoot,row.raw_sha256,Number(row.byte_length));
  let decoded:unknown;
  try{decoded=JSON.parse(bytes.toString("utf8"));}
  catch{throw new FutuFinancialCaptureError(503,"PAGE_ORIGINAL_INVALID","captured financial page JSON is invalid");}
  if(!validBridgePage(decoded,row.capture_symbol,FUTU_STATEMENT_CODE[row.statement_type],
    Number(row.capture_page_size),row.requested_cursor,new Date(),row.capture_financial_type)
    || decoded.next_key!==row.next_cursor
    || new Date(decoded.captured_at).getTime()!==new Date(row.captured_at).getTime()
    || summaries(decoded.report_list).length!==row.report_summaries.length
    || !summaries(decoded.report_list).every((summary,index)=>Object.entries(summary).every(
      ([key,value])=>row.report_summaries[index]?.[key as keyof FutuFinancialReportSummary]===value)))
    throw new FutuFinancialCaptureError(503,"PAGE_METADATA_DRIFT","captured financial page differs from its stored identity");
  return {page:pageData(row,"available"),bytes};
}

export type FutuFinancialReportObservation = {
  selection:"annual"|"half_year";statementType:FutuStatementType;financialType:"ANNUAL"|"Q6";
  periodEnd:string;currencyCode:string;originalAvailable:boolean
};

export function futuCaptureScopeLimitations(selection:"annual"|"half_year",tables:FutuFinancialTableStates):string[]{
  return FUTU_STATEMENT_TYPES.flatMap(type=>{
    const state=tables[type];
    if(state.status==="complete")return [];
    return [state.reasonCode==="MIXED_CURRENCY"
      ? `${selection}/${type} 整次历史捕获含不同币种（MIXED_CURRENCY）；所选最近期间另行按原件核对`
      : `${selection}/${type} 整次历史捕获部分取得（${state.reasonCode??"原因未知"}）；所选最近期间另行核对`];
  });
}

/** Evaluate the selected recent range from report identities and verified original values. */
export function projectFutuFinancialTargetRange(all:FutuFinancialHistoryValue[],observed:FutuFinancialReportObservation[]){
  const annualEnds=[...new Set(observed.filter(row=>row.selection==="annual"&&row.financialType==="ANNUAL")
    .map(row=>row.periodEnd))].sort().reverse();
  const latestAnnual=annualEnds[0];
  const expectedAnnual=latestAnnual?Array.from({length:5},(_,i)=>`${Number(latestAnnual.slice(0,4))-i}-12-31`):[];
  const latestHalfYearPeriodEnd=observed.filter(row=>row.selection==="half_year"&&row.financialType==="Q6")
    .map(row=>row.periodEnd).sort().at(-1)??null;
  const halfYearPeriodEnds=latestHalfYearPeriodEnd?[latestHalfYearPeriodEnd,
    `${Number(latestHalfYearPeriodEnd.slice(0,4))-1}-06-30`]:[];
  const selectedValues=all.filter(value=>value.financialType==="ANNUAL"?expectedAnnual.includes(value.periodEnd)
    :halfYearPeriodEnds.includes(value.periodEnd));
  const gaps:string[]=[],conflicted=new Set<string>();
  const check=(selection:"annual"|"half_year",financialType:"ANNUAL"|"Q6",end:string)=>{
    const label=`${end} ${financialType==="ANNUAL"?"年度":"累计半年"}`;
    const key=`${financialType}:${end}`;
    const reports=observed.filter(row=>row.selection===selection&&row.financialType===financialType&&row.periodEnd===end);
    for(const type of FUTU_STATEMENT_TYPES){
      const table=reports.filter(row=>row.statementType===type);
      if(table.length!==1)gaps.push(`${label} ${type} 报告${table.length?"重复或期间冲突":"缺失"}`);
      if(table.length>1)conflicted.add(key);
      if(table.some(row=>!row.originalAvailable))gaps.push(`${label} ${type} 原始响应不可读取`);
    }
    const period=selectedValues.filter(value=>value.financialType===financialType&&value.periodEnd===end);
    if(period.length!==5||new Set(period.map(value=>value.metric)).size!==5
      ||new Set(period.map(value=>value.currencyCode)).size!==1)
      gaps.push(`${label} 五项同币种提供商值不完整或重复`);
    if(period.length>5||new Set(period.map(value=>value.metric)).size!==period.length)conflicted.add(key);
    const expectedStart=`${end.slice(0,4)}-01-01`;
    if(period.some(value=>value.periodKind==="duration"?value.periodStart!==expectedStart
      :value.periodKind!=="instant"||value.periodStart!==null)){
      gaps.push(`${label} 期间起止或时点口径冲突`);
      conflicted.add(key);
    }
  };
  if(!expectedAnnual.length)gaps.push("没有可核对的年度报告期间");
  else for(const end of expectedAnnual)check("annual","ANNUAL",end);
  if(!latestHalfYearPeriodEnd)gaps.push("没有可核对的累计半年报告期间");
  else for(const end of halfYearPeriodEnds)check("half_year","Q6",end);
  const targetReports=observed.filter(row=>row.financialType==="ANNUAL"&&expectedAnnual.includes(row.periodEnd)
    ||row.financialType==="Q6"&&halfYearPeriodEnds.includes(row.periodEnd));
  const currencies=new Set([...selectedValues.map(value=>value.currencyCode),...targetReports.map(row=>row.currencyCode)]);
  if(currencies.size>1)gaps.push("所选最近五年及累计半年范围含不同币种，不能合并金额或作同币种比较");
  const observedCurrencyCode=currencies.size===1?[...currencies][0]!:null;
  if(observedCurrencyCode&&!["CNY","HKD","USD"].includes(observedCurrencyCode))
    gaps.push(`所选范围币种 ${observedCurrencyCode} 未支持量化引用；原值仍可查看`);
  const values=selectedValues.filter(value=>!conflicted.has(`${value.financialType}:${value.periodEnd}`));
  return {annualPeriodEnds:expectedAnnual,halfYearPeriodEnds,latestHalfYearPeriodEnd,values,
    gaps:[...new Set(gaps)],observedCurrencyCode,
    status:gaps.length?(values.length?"partial":"unavailable"):"available"} as const;
}

/** A bounded provider-only history, assembled from the latest explicit annual and H1 captures. */
export async function readFutuFinancialHistory(client:Reader,membershipId:string,
  actor:AuthenticatedResearchActor,store:Store):Promise<FutuFinancialHistoryData>{
  const member=await readCandidateMembershipById(client,actor,membershipId);
  if(!member||member.state!=="tracked")throw new CandidateMembershipNotFoundError();
  const rows=(await client.query<{id:string;requested_financial_type:5|7}>(`select distinct on (requested_financial_type) id::text,requested_financial_type
    from research_futu_financial_statement_captures where candidate_membership_id=$1 and actor_type=$2 and actor_id=$3
      and captured_membership_version=$4 and requested_financial_type in (5,7)
    order by requested_financial_type,captured_at desc,id desc`,[membershipId,actor.actorType,actor.actorId,member.version])).rows;
  const ids={annual:rows.find(row=>row.requested_financial_type===7)?.id??null,
    half_year:rows.find(row=>row.requested_financial_type===5)?.id??null};
  const captureLimitations:string[]=[],targetReadGaps:string[]=[],all:FutuFinancialHistoryValue[]=[],observed:FutuFinancialReportObservation[]=[];
  for(const selection of ["annual","half_year"] as const){
    const id=ids[selection];
    if(!id){targetReadGaps.push(selection==="annual"?"尚无明确年度三表捕获":"尚无明确累计半年三表捕获");continue;}
    try{
      const capture=await readFutuFinancialCapture(client,membershipId,id,actor,store);
      if(capture.symbol!==member.symbol||capture.membershipVersion!==Number(member.version)
        ||capture.periodSelection!==selection)throw new Error("capture identity changed");
      captureLimitations.push(...futuCaptureScopeLimitations(selection,capture.tables));
      for(const page of capture.pages){
        let originalAvailable=false;
        if(page.originalAvailability==="available")try{
          const original=await readFutuFinancialOriginal(client,membershipId,id,page.id,actor,store);
          const data=JSON.parse(original.bytes.toString("utf8")) as import("../../../../packages/contracts/src/researchFutuFinancialStatement.js").FutuFinancialBridgePage;
          all.push(...projectFutuFinancialHistoryValues(data,selection,{captureId:id,pageId:page.id,
            rawSha256:page.rawSha256,capturedAt:page.capturedAt,reportSha256s:page.reports.map(report=>report.reportSha256)}));
          originalAvailable=true;
        }catch{/* Preserve the page identity, but never use a failed original as a value. */}
        for(const report of page.reports){
          if(report.financialType!=="ANNUAL"&&report.financialType!=="Q6"){
            captureLimitations.push(`${selection}/${page.statementType} 捕获页 #${page.id} 报告期间类型不可识别`);
            continue;
          }
          observed.push({selection,statementType:page.statementType,financialType:report.financialType,
            periodEnd:report.periodEnd,currencyCode:report.currencyCode,originalAvailable});
        }
        if(!originalAvailable)captureLimitations.push(`${selection}/${page.statementType} 捕获页 #${page.id} 原件不可读取`);
      }
    }catch{targetReadGaps.push(`${selection} 捕获原件或身份核验失败`);}
  }
  const range=projectFutuFinancialTargetRange(all,observed);
  const gaps=[...new Set([...targetReadGaps,...range.gaps])];
  return {symbol:member.symbol,membershipId,membershipVersion:Number(member.version),
    sourceClassification:FUTU_FINANCIAL_STATEMENT_SOURCE,status:gaps.length?range.values.length?"partial":"unavailable":"available",
    annualCaptureId:ids.annual,halfYearCaptureId:ids.half_year,annualPeriodEnds:range.annualPeriodEnds,
    halfYearPeriodEnds:range.halfYearPeriodEnds,latestHalfYearPeriodEnd:range.latestHalfYearPeriodEnd,
    values:range.values,gaps,captureLimitations:[...new Set(captureLimitations)].slice(0,30),
    observedCurrencyCode:range.observedCurrencyCode,
    comparisonNotices:observedFutuComparisonNotices(member.symbol,range.values),
    issuerOriginalVerification:"UNKNOWN",restatementComparability:"UNKNOWN",
    latestRequiredFiling:"UNKNOWN"};
}
