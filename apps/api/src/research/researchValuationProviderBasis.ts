import type {Pool,PoolClient} from "pg";
import {createHash} from "node:crypto";
import type {AuthenticatedResearchActor} from "./domain.js";
import {readCandidateMembershipById} from "./candidateMembershipPersistence.js";
import {readFutuFinancialCapture,readFutuFinancialOriginal,FutuFinancialCaptureError} from "./researchFutuFinancialStatementRepository.js";
import type {FutuAnnualEpsReference} from "../../../../packages/contracts/src/researchValuationProvider.js";
import type {FutuFinancialCaptureData,FutuFinancialPageData,FutuFinancialMaterialPreview} from "../../../../packages/contracts/src/researchFutuFinancialStatement.js";
import type {FutuProviderValuationPreview} from "../../../../packages/contracts/src/researchValuationProvider.js";
import {readFutuValuationOriginal} from "./researchValuationProviderRepository.js";
import {readFutuFinancialMaterialPreview} from "./researchFutuFinancialStatementRepository.js";
import type {FutuFinancialBridgePage} from "../../../../packages/contracts/src/researchFutuFinancialStatement.js";

type Reader=Pick<Pool|PoolClient,"query">;
type Store={repositoryRoot:string;rawStoreRoot?:string|null};
const names={basic:{fieldId:5054,name:"基本每股收益"},diluted:{fieldId:5055,name:"稀释每股收益"}} as const;
export const providerBasisFingerprint=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** EPS stays separate from the five integer totals and from issuer-reported fundamentals. */
export async function readFutuAnnualEps(client:Reader,membershipId:string,captureId:string,
  annualPeriodEnd:string,basis:"basic"|"diluted",actor:AuthenticatedResearchActor,store:Store):Promise<FutuAnnualEpsReference[]>{
  const member=await readCandidateMembershipById(client,actor,membershipId);
  const capture=await readFutuFinancialCapture(client,membershipId,captureId,actor,store);
  if(!member||member.state!=="tracked"||capture.symbol!==member.symbol
    ||capture.membershipVersion!==Number(member.version)||capture.periodSelection!=="annual")
    throw new FutuFinancialCaptureError(409,"EPS_CAPTURE_INELIGIBLE","current explicit annual income capture is required");
  const incomePages=completeIncomePageChain(capture);
  const originals=await Promise.all(incomePages.map(async page=>({page,
    decoded:JSON.parse((await readFutuFinancialOriginal(client,membershipId,captureId,page.id,actor,store))
      .bytes.toString("utf8")) as FutuFinancialBridgePage})));
  return selectFutuAnnualEpsWindow(capture,originals,annualPeriodEnd,basis);
}

/** The captured table can be partial for an older currency change, but its page chain must be terminal. */
export function completeIncomePageChain(capture:FutuFinancialCaptureData):FutuFinancialPageData[]{
  const state=capture.tables.income;
  const pages=capture.pages.filter(page=>page.statementType==="income")
    .sort((a,b)=>a.pageNumber-b.pageNumber);
  const eligibleState=state.status==="complete"&&state.reasonCode===null&&state.requestPaginationComplete
    ||state.status==="partial"&&state.reasonCode==="MIXED_CURRENCY"&&!state.requestPaginationComplete;
  if(capture.periodSelection!=="annual"||!eligibleState||!state.currentOriginalsAvailable
    ||!pages.length||pages.length!==state.pageCount||pages.length>capture.maxPagesPerTable
    ||pages.reduce((count,page)=>count+page.reports.length,0)!==state.reportCount
    ||state.lastNextCursor!=="-1"||pages.at(-1)?.nextCursor!=="-1"
    ||pages.some((page,index)=>page.captureId!==capture.id||page.pageNumber!==index+1
      ||page.originalAvailability!=="available"
      ||page.requestedCursor!==(index===0?null:pages[index-1]!.nextCursor)
      ||index<pages.length-1&&page.nextCursor==="-1"))
    throw new FutuFinancialCaptureError(409,"EPS_CAPTURE_INELIGIBLE","annual income pages must form a complete original-backed terminal chain");
  return pages;
}

/** Pure selected-window check; original bytes and report summaries are verified by readFutuFinancialOriginal. */
export function selectFutuAnnualEpsWindow(capture:FutuFinancialCaptureData,
  originals:Array<{page:FutuFinancialPageData;decoded:FutuFinancialBridgePage}>,
  annualPeriodEnd:string,basis:"basic"|"diluted"):FutuAnnualEpsReference[]{
  const pages=completeIncomePageChain(capture);
  if(!/^20\d{2}-12-31$/.test(annualPeriodEnd))
    throw new FutuFinancialCaptureError(409,"EPS_PERIOD_INVALID","selected annual EPS period is invalid");
  const selectedYear=Number(annualPeriodEnd.slice(0,4));
  const wanted=new Set(Array.from({length:5},(_,index)=>`${selectedYear-index}-12-31`));
  const field=names[basis];
  const found=new Map<string,FutuAnnualEpsReference>();
  const currencyLabels=new Set<string>();
  for(const {page,decoded} of originals){
    if(!pages.some(candidate=>candidate.id===page.id)||decoded.statement_type!==1)
      throw new FutuFinancialCaptureError(409,"EPS_SOURCE_DRIFT","annual EPS page identity changed");
    const selectedReports=decoded.report_list.filter(report=>wanted.has(report.date_time_str));
    if(!selectedReports.length)continue;
    const structure=decoded.structure_list.filter((item):item is {field_id:number;display_name:string}=>
      !!item&&typeof item==="object"&&"field_id" in item&&"display_name" in item
      &&item.field_id===field.fieldId&&item.display_name===field.name);
    if(structure.length!==1)
      throw new FutuFinancialCaptureError(409,"EPS_FIELD_AMBIGUOUS","selected annual EPS source field is unavailable or ambiguous");
    for(const report of selectedReports){
      const year=Number(report.date_time_str.slice(0,4));
      if(found.has(report.date_time_str))
        throw new FutuFinancialCaptureError(409,"EPS_PERIOD_AMBIGUOUS","selected annual EPS period has more than one source");
      const summary=page.reports.filter(row=>row.periodEnd===report.date_time_str&&row.financialType==="ANNUAL");
      if(report.financial_type!=="ANNUAL"||report.fiscal_year!==year||summary.length!==1
        ||summary[0]!.currencyCode!==report.currency_code
        ||summary[0]!.accountingStandards!==report.accounting_standards
        ||summary[0]!.reportSha256!==createHash("sha256").update(JSON.stringify(report)).digest("hex")
        ||!report.accounting_standards.trim()||!report.currency_info.trim()
        ||!["CNY","HKD","USD"].includes(report.currency_code))
        throw new FutuFinancialCaptureError(409,"EPS_SOURCE_DRIFT","selected annual EPS period or accounting basis changed");
      const items=report.item_list.filter(item=>item.field_id===field.fieldId&&item.display_name===field.name);
      if(items.length!==1||!validEps(items[0]!.data))
        throw new FutuFinancialCaptureError(409,"EPS_VALUE_INVALID","selected annual EPS must be one finite bounded per-share decimal");
      currencyLabels.add(report.currency_info.trim());
      found.set(report.date_time_str,{financialCaptureId:capture.id,pageId:page.id,rawSha256:page.rawSha256,
        reportSha256:summary[0]!.reportSha256,periodEnd:report.date_time_str,fiscalYear:year,
        accountingStandards:report.accounting_standards,capturedAt:page.capturedAt,
        currencyCode:report.currency_code,basis,fieldId:field.fieldId,rawValue:String(items[0]!.data)});
    }
  }
  const out=Array.from(wanted,period=>found.get(period));
  if(out.some(row=>!row)||new Set(out.map(row=>row!.currencyCode)).size!==1
    ||new Set(out.map(row=>row!.accountingStandards)).size!==1||currencyLabels.size!==1)
    throw new FutuFinancialCaptureError(409,"EPS_HISTORY_INCOMPLETE","five consecutive same-currency and same-standard annual EPS sources are required");
  return out as FutuAnnualEpsReference[];
}

function validEps(value:unknown):value is number {
  return typeof value==="number"&&Number.isFinite(value)&&value>0&&value<=10000
    &&Math.abs(value-Math.round(value*1_000_000)/1_000_000)<1e-10;
}

export function currentProviderSourceMaterial(material:FutuFinancialMaterialPreview,id:string){
  return material.materials.find(row=>row.id===id&&row.sourceVersion===material.sourceVersion
    &&row.contentFingerprint===material.contentFingerprint)??null;
}

export async function readFutuProviderValuationPreview(client:Reader,membershipId:string,
  financialCaptureId:string,annualPeriodEnd:string,basis:"basic"|"diluted",valuationCaptureId:string,
  sourceMaterialId:string,actor:AuthenticatedResearchActor,store:Store):Promise<FutuProviderValuationPreview>{
  const eps=await readFutuAnnualEps(client,membershipId,financialCaptureId,annualPeriodEnd,basis,actor,store);
  const selected=eps[0]!;
  const material=await readFutuFinancialMaterialPreview(client,membershipId,financialCaptureId,
    "ANNUAL",annualPeriodEnd,actor,store);
  const match=currentProviderSourceMaterial(material,sourceMaterialId);
  if(!match)
    throw new FutuFinancialCaptureError(409,"EPS_MATERIAL_NOT_CURRENT","save the exact current OpenD capture and period as unverified research material first");
  const valuation=await readFutuValuationOriginal(client,membershipId,valuationCaptureId,actor,store);
  if(valuation.capture.membershipVersion!==material.source.membershipVersion
    ||valuation.capture.symbol!==material.source.symbol||valuation.capture.valuationType!=="PE"
    ||valuation.capture.originalAvailability!=="available"
    ||Date.parse(valuation.capture.lastHistoricalDate)<Date.parse(valuation.capture.firstHistoricalDate)+4*365*86400000)
    throw new FutuFinancialCaptureError(409,"VALUATION_BASIS_INVALID","same-member five-year PE original is required");
  const growth=eps.slice(0,4).map((newer,index)=>({fromYear:eps[index+1]!.fiscalYear,
    toYear:newer.fiscalYear,rate:Number((Number(newer.rawValue)/Number(eps[index+1]!.rawValue)-1).toFixed(6))}));
  const source={kind:"provider" as const,sourceClassification:"third_party_statement" as const,
    membershipId,membershipVersion:material.source.membershipVersion,symbol:material.source.symbol,
    sourceMaterialId,sourceMaterialRevision:match.revision,sourceMaterialFingerprint:match.contentFingerprint,
    eps:selected,valuation:{captureId:valuation.capture.id,rawSha256:valuation.capture.rawSha256,
      valuationType:"PE" as const,intervalType:"YEAR_5" as const,capturedAt:valuation.capture.capturedAt,
      providerUpdatedAt:valuation.capture.providerUpdatedAt,currentValue:valuation.capture.currentValue,
      historicalAverage:valuation.capture.historicalAverage,historicalPercentile:valuation.capture.historicalPercentile,
      historicalCount:valuation.capture.historicalCount,firstHistoricalDate:valuation.capture.firstHistoricalDate,
      lastHistoricalDate:valuation.capture.lastHistoricalDate},
    issuerOriginalVerification:"UNKNOWN" as const,restatementComparability:"UNKNOWN" as const,
    publicationTime:"UNKNOWN" as const,currencyConversion:"NONE" as const};
  const proposed={metricCurrency:selected.currencyCode,baseMetricPerShare:Number(selected.rawValue),
    terminalMultipleReference:valuation.capture.historicalAverage,historicalEpsGrowthReferences:growth};
  return {basis:source,sourceFingerprint:providerBasisFingerprint({source,proposed}),
    methodId:"discounted_forward_metric_multiple_user_scenario",proposed,
    limitations:["OpenD is third-party and not issuer-verified; restatement comparability remains unknown.",
      "Historical EPS growth and PE average are references, not future growth or a fair terminal multiple.",
      `${selected.currencyCode} per-share scenario is not comparable with HKD quote without a sourced FX conversion.`,
      "Net cash per share and discount rate are not inferred from these sources."]};
}
