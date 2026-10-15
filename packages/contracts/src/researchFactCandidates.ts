import {factIdentity,canonicalPeriod,type FactIdentity} from "./researchFactIdentity.js";
import { researchTableRegions } from "./researchTableRegions.js";
import { operatingModelFingerprint, type OperatingFact } from "./researchOperatingModel.js";
export interface StructuredFactCandidate {
  documentReviewState?:"TRUSTED"|"NEEDS_REVIEW"|"REJECTED";confirmationAllowed?:boolean;
  templateId?:string; unit?:OperatingFact["unit"]; measurementBasis?:OperatingFact["measurementBasis"]; accountingScope?:string; businessScope?:string; category?:"actual"|"guidance"; comparability?:"comparable"|"not_comparable"; capturedSourceUrl?:string|null;
  suggestedBusinessScope?:string;
  confirmationState?:"review_required"|"already_confirmed";
  mix?:OperatingFact["mix"];
  classification?:"NEW_FACT"|"VERIFICATION_UPGRADE"|"POSSIBLE_CORRECTION"|"AMBIGUOUS"|"ADDITIONAL_SOURCE"|"CONFLICTING_ASSERTION"|"DISTINCT_FACT"|"SCOPE_REVIEW_REQUIRED"; structureExcerpt?:string; materialRevision?:number|null; sourceMaterialId?:string|null; documentPdfSha256?:string;
  id:string; status:"CANDIDATE"; purpose:"new_fact"|"verification_upgrade"; existingFactId:string|null;
  symbol:string; membershipId:string; membershipVersion:number; metric:string; proposedValue:string;
  rawValueText:string; periodStart:string|null; periodEnd:string; currency:string; unitScale:number;
  documentId:string; pageNumber:number; pageTextSha256:string; sourceUrl:string;
  rowLabelText:string; columnHeaderText:string; unitHeaderText:string; sourceExcerpt:string;
  extractionMethod:"deterministic_row_pattern"; confidence:"review_required"; limitation:string;
}
const ROWS=[
  ["revenue","Revenue"],["gross_profit","Gross profit"],
  ["profit_attributable_to_owners","Owners of the parent"],["operating_cash_flow","Net cash generated from operating activities"],
  ["research_and_development_expense","Research and development expenses"],
  ["selling_and_distribution_expense","Distribution and selling expenses"],["administrative_expense","Administrative expenses"]
];
/** No writes: table text proposes first-column candidates, never verified FACTs. */
function financialCandidates(page:{documentId:string;pageNumber:number;pageTextSha256:string;text:string;sourceUrl:string},identity:{symbol:string;membershipId:string;membershipVersion:number},facts:OperatingFact[]):StructuredFactCandidate[] {
  const header=/Six months ended 30 June (\d{4})/.exec(page.text), unit=["RMB’000","RMB'000"].find(s=>page.text.includes(s));
  const rows:Array<{metric:string;label:string;column:string;unit:string;start:string|null;end:string;currency:string;scale:number}>=[];
  if(header&&unit)for(const [metric,label] of ROWS)rows.push({metric:metric!,label:label!,column:header[0],unit,start:`${header[1]}-01-01`,end:`${header[1]}-06-30`,currency:"CNY",scale:1000});
  const aspUnit=["RMB per vehicle","RMB/vehicle"].find(u=>page.text.includes(u));
  if(header&&aspUnit)rows.push({metric:"average_selling_price",label:"Average selling price",column:header[0],unit:aspUnit,start:`${header[1]}-01-01`,end:`${header[1]}-06-30`,currency:"CNY",scale:1});
  const balance=/30 June (\d{4})/.exec(page.text);
  if(balance&&unit&&page.text.includes("STATEMENT OF FINANCIAL POSITION"))for(const [metric,label] of [["total_assets","Total assets"],["total_liabilities","Total liabilities"]])rows.push({metric:metric!,label:label!,column:balance[0],unit,start:null,end:`${balance[1]}-06-30`,currency:"CNY",scale:1000});
  if(page.text.includes("Number of shares")&&page.text.includes("Issued and fully paid")){
    const dates=[...page.text.matchAll(/At 30 June (\d{4}) \(unaudited\)/g)];
    for(const d of dates)rows.push({metric:"issued_shares",label:d[0],column:d[0],unit:"Number of shares",start:null,end:`${d[1]}-06-30`,currency:"XXX",scale:1});
  }
  const financial=rows.flatMap(row=>{
    const escaped=row.label.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    const matches=[...page.text.matchAll(new RegExp(escaped+String.raw`(?: \d+(?:\([a-z]\))?)? \(?([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?)\)?`,"g"))];
    if(matches.length!==1)return [];
    const m=matches[0]!,raw=m[1]!,value=raw.replaceAll(",","");
    const existing=facts.filter(f=>f.metric===row.metric&&f.period.start===row.start&&f.period.end===row.end&&f.source.documentId===page.documentId&&f.source.pageNumber===page.pageNumber);

    const data={symbol:identity.symbol,membershipId:identity.membershipId,membershipVersion:identity.membershipVersion,metric:row.metric,proposedValue:value,rawValueText:raw,periodStart:row.start,periodEnd:row.end,currency:row.currency,unitScale:row.scale,documentId:page.documentId,pageNumber:page.pageNumber,pageTextSha256:page.pageTextSha256,sourceUrl:page.sourceUrl,rowLabelText:row.label,columnHeaderText:row.column,unitHeaderText:row.unit,sourceExcerpt:m[0]};
    const region=researchTableRegions(page.text).find(r=>[row.label,row.column,row.unit,m[0]].every(label=>r.includes(label)));
    const classification:StructuredFactCandidate["classification"]=existing.length>1||!region||m[0].includes(`(${raw}`)?"AMBIGUOUS":!existing.length?"NEW_FACT":existing[0]!.value*existing[0]!.unitScale===Number(value)*row.scale?"VERIFICATION_UPGRADE":"POSSIBLE_CORRECTION";
    return [{...data,classification,structureExcerpt:region,id:operatingModelFingerprint(data),status:"CANDIDATE" as const,purpose:existing.length?"verification_upgrade" as const:"new_fact" as const,existingFactId:existing[0]?.id??null,extractionMethod:"deterministic_row_pattern" as const,confidence:"review_required" as const,limitation:"候选不是 FACT。需核对列顺序、费用符号、业务范围和来源标签；保留未经审计与重列限制，不自动写入或替换旧值。"}];
  });
  return financial.map(c=>({...c,templateId:"generic_financial_statement",measurementBasis:c.metric==="issued_shares"?"issued_shares" as const:"financial_statement" as const,unit:c.metric==="issued_shares"?"shares" as const:c.metric==="average_selling_price"?"currency_per_vehicle" as const:"currency" as const,accountingScope:page.text.includes("CONSOLIDATED")?"consolidated":"unknown",businessScope:"unknown",category:"actual" as const,comparability:"comparable" as const,capturedSourceUrl:page.sourceUrl||null}));
}

function salesCandidates(page:{documentId:string;pageNumber:number;pageTextSha256:string;text:string;sourceUrl:string},identity:{symbol:string;membershipId:string;membershipVersion:number}):StructuredFactCandidate[] {
  if(!page.text.includes("Geely Automobile Holdings Limited"))return [];
  const region=researchTableRegions(page.text).find(r=>r.startsWith("Bran"));
  const date=/\b(January|February|March|April|May|June|July|August|September|October|November|December) (20\d{2})\b/.exec(page.text);
  if(!region||!date||!region.includes("The same period last year (Unit)"))return [];
  const month=["January","February","March","April","May","June","July","August","September","October","November","December"].indexOf(date[1]!)+1;
  const definitions=[{label:"Geely",node:"Geely"},{label:"of which: Galaxy",node:"Galaxy",parent:"Geely"},{label:"LYNK & CO",node:"LYNK & CO"},{label:"ZEEKR",node:"ZEEKR"},{label:"Total",node:null}];
  return definitions.flatMap(d=>{
    const match=new RegExp(d.label+" ([0-9]{1,3}(?:,[0-9]{3})+) ([0-9]{1,3}(?:,[0-9]{3})+)(?![0-9,])").exec(region);
    if(!match)return [];
    return [0,1].map(index=>{
      const year=Number(date[2])-index,start=`${year}-${String(month).padStart(2,"0")}-01`,end=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
      const mix:OperatingFact["mix"]=d.node?{dimension:"brand",dimensionValue:d.node,parentScope:"Geely issuer sales total excluding Proton",...(d.parent?{parentNode:d.parent}:{}),overlapPolicy:d.parent?"nested":"mutually_exclusive"}:undefined;
      const data={...identity,templateId:"geely_monthly_sales_v1",unit:"vehicles" as const,measurementBasis:"issuer_sales" as const,accountingScope:"consolidated",businessScope:"Geely issuer sales total excluding Proton",category:"actual" as const,comparability:"comparable" as const,capturedSourceUrl:page.sourceUrl||null,metric:d.node?"product_mix_volume":"sales_volume",proposedValue:match[index+1]!.replaceAll(",",""),rawValueText:match[index+1]!,periodStart:start,periodEnd:end,currency:"XXX",unitScale:1,documentId:page.documentId,pageNumber:page.pageNumber,pageTextSha256:page.pageTextSha256,sourceUrl:page.sourceUrl,rowLabelText:d.label,columnHeaderText:index?"The same period last year (Unit)":"Current month (Unit)",unitHeaderText:"(Unit)",sourceExcerpt:match[0],structureExcerpt:region,...(mix?{mix}:{})};
      return {...data,id:operatingModelFingerprint(data),status:"CANDIDATE" as const,purpose:"new_fact" as const,classification:"NEW_FACT" as const,existingFactId:null,extractionMethod:"deterministic_row_pattern" as const,confidence:"review_required" as const,limitation:"未经审计。期间为文档月份候选；必须由 Owner 核对期间、列顺序、范围及分类。未自动完成结构验证。"};
    });
  });
}

export interface CandidatePageInput {documentId:string;pageNumber:number;pageTextSha256:string;text:string;sourceUrl:string}
export interface CandidateIssuerIdentity {symbol:string;membershipId:string;membershipVersion:number}
export interface ExtractorTemplate {id:string;pageHints?:readonly string[];recognizes:(page:CandidatePageInput)=>boolean;extract:(page:CandidatePageInput,identity:CandidateIssuerIdentity,facts:OperatingFact[])=>StructuredFactCandidate[]}
export const DEFAULT_EXTRACTOR_REGISTRY:readonly ExtractorTemplate[]=[
 {id:"generic_financial_statement",pageHints:["Average selling price","Revenue","STATEMENT OF FINANCIAL POSITION","Net cash generated from operating activities","Number of shares"],recognizes:p=>/STATEMENT OF|Issued and fully paid|Six months ended/.test(p.text),extract:financialCandidates},
 {id:"geely_monthly_sales_v1",pageHints:["Current month"],recognizes:p=>p.text.includes("Geely Automobile Holdings Limited")&&p.text.includes("Current month"),extract:salesCandidates}
];
export function extractFactCandidates(page:CandidatePageInput,identity:CandidateIssuerIdentity,facts:OperatingFact[],registry:readonly ExtractorTemplate[]=DEFAULT_EXTRACTOR_REGISTRY):StructuredFactCandidate[]{return registry.filter(t=>t.recognizes(page)).flatMap(t=>t.extract(page,identity,facts));}
export function candidateFactIdentity(c:StructuredFactCandidate):FactIdentity {
 return factIdentity({...c,category:c.category??"actual",unit:c.unit??"currency",currency:c.currency==="XXX"?null:c.currency,accountingScope:c.accountingScope??"unknown",businessScope:c.businessScope??"unknown",measurementBasis:c.measurementBasis??"financial_statement",period:canonicalPeriod(c.periodStart?"duration":"instant",c.periodStart,c.periodEnd)});
}
