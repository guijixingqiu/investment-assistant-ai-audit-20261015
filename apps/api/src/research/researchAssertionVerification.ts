import { sameSourceTable } from "../../../../packages/contracts/src/researchTableRegions.js";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { CreateResearchFundamentalValueRequest } from "../../../../packages/contracts/src/researchFundamentals.js";
import { ResearchFundamentalError } from "./domain.js";

const MAGNITUDE_OUTFLOW_METRICS = new Set<CreateResearchFundamentalValueRequest["metric"]>([
  "property_plant_equipment_purchases", "intangible_asset_purchases", "land_lease_prepayments",
  "capital_expenditure", "research_and_development_expense", "selling_and_distribution_expense",
  "administrative_expense"
]);

/** Exact text only. Parentheses retain their source sign; only listed outflows store a positive magnitude. */
export function sourceTextMatches(page:string, hash:string, excerpt:string, raw:string, value:string|null,
  metric?:CreateResearchFundamentalValueRequest["metric"]):boolean {
  if(createHash("sha256").update(page).digest("hex")!==hash || !excerpt || !raw || !page.includes(excerpt) || !excerpt.includes(raw) || value===null)return false;
  const escaped=raw.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  if(!new RegExp(`(?<![0-9.,+%()\\-])${escaped}(?![0-9.,%])`).test(excerpt))return false;
  if(!/^-?\d+(?:\.\d+)?$/.test(value))return false;
  const parenthesized=/^\((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\)$/.test(raw);
  if(parenthesized){
    if(!metric || value.startsWith("-")===MAGNITUDE_OUTFLOW_METRICS.has(metric))return false;
    const left=decimalParts(raw.slice(1,-1).replaceAll(",","")),right=decimalParts(value.replace(/^-/,""));
    if(left.integer===0n&&!MAGNITUDE_OUTFLOW_METRICS.has(metric))return false;
    return left.integer*10n**BigInt(right.scale)===right.integer*10n**BigInt(left.scale);
  }
  if(!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?$/.test(raw))return false;
  const left=decimalParts(raw.replaceAll(",","").replace("%","")),right=decimalParts(value);
  const scale=left.scale+(raw.endsWith("%")?2:0);
  return left.integer*10n**BigInt(right.scale)===right.integer*10n**BigInt(scale);
}
/** Deterministic vocabulary; unknown labels are not silently interpreted. */
const ROW_LABELS:Record<string,string[]>={
  total_assets:["Total assets"],total_liabilities:["Total liabilities"],revenue:["Revenue"],gross_profit:["Gross profit"],profit_attributable_to_owners:["Owners of the parent"],
  operating_cash_flow:["Net cash generated from operating activities"],research_and_development_expense:["Research and development expenses"],
  selling_and_distribution_expense:["Distribution and selling expenses"],administrative_expense:["Administrative expenses"],
  sales_volume:["Total"],issued_shares:["At 30 June 2026 (unaudited)"],average_selling_price:["Average selling price"],
  gross_margin:["Gross margin"],core_profit_attributable_to_owners:["Core profit attributable to owners of the Company"]
};
export function verifyAssertionStructure(page:string,request:CreateResearchFundamentalValueRequest,valueVerification:"source_text_verified"|"owner_confirmed"|"unverified",actorId:string,confirmedAt=new Date().toISOString()) {
  const a=request.assertion!, b=a.structureBinding, t=a.textBinding ?? a.snapshotTextBinding;
  const checks={metric:false,period:false,currency:false,unitScale:false,scope:false,...(a.mix?{taxonomy:false}:{})};
  if(b&&t&&valueVerification==="source_text_verified"){
    const labelsPresent=sameSourceTable(page,b.structureExcerpt,[b.rowLabelText,b.columnHeaderText,b.unitHeaderText,t.sourceExcerpt,t.rawValueText]);
    // Bind the value to its row, not merely to a number elsewhere on the page.
    const row=t.sourceExcerpt.indexOf(b.rowLabelText), raw=t.sourceExcerpt.indexOf(t.rawValueText,row+b.rowLabelText.length);
    const between=row<0||raw<0?"!":t.sourceExcerpt.slice(row+b.rowLabelText.length,raw);
    const adjacent=row>=0&&raw>=0&&/^\s*(?:\d{1,2}(?:\([a-z]\))?\s+)?$/.test(between)&&between.length<20&&firstRowAmount(b.structureExcerpt??"",b.rowLabelText)===t.rawValueText;
    const expected=request.metric==="product_mix_volume"&&a.mix?[a.mix.dimensionValue]:ROW_LABELS[request.metric]??[];
    checks.metric=labelsPresent&&adjacent&&(!a.mix||request.metric==="product_mix_volume")&&expected.includes(b.rowLabelText);
    const period=financialPeriod(b.columnHeaderText,request);
    checks.period=labelsPresent&&period;
    const unit=sourceUnit(b.unitHeaderText,a.unit);
    checks.currency=labelsPresent&&unit!==null&&unit.currency===request.currency;
    checks.unitScale=labelsPresent&&unit!==null&&unit.scale===request.unitScale;
    checks.scope=labelsPresent&&request.scope==="consolidated"&&b.scopeText==="Group"&&a.businessScope==="Group"&&b.structureExcerpt!.includes(`Group ${b.columnHeaderText}`);
  }
  const confirmedFields=a.structureConfirmation?.confirmedFields??[];
  const ownerConfirmation=confirmedFields.length?{confirmedFields,confirmedBy:actorId,confirmedAt}:undefined;
  const covered=Object.entries(checks).every(([key,verified])=>verified||confirmedFields.includes(key as typeof confirmedFields[number]));
  return {valueVerification,structureVerification:Object.values(checks).every(Boolean)?"source_labels_verified" as const:covered&&ownerConfirmation?"owner_confirmed" as const:"unverified" as const,checks,taxonomyConfirmedBy:confirmedFields.includes("taxonomy")?actorId:null,...(ownerConfirmation?{ownerConfirmation}:{})};
}
function financialPeriod(header:string,r:CreateResearchFundamentalValueRequest):boolean {
  const m=/^Six months ended 30 June (\d{4})$/.exec(header);
  if(m)return r.periodKind==="duration"&&r.periodStart===`${m[1]}-01-01`&&r.periodEnd===`${m[1]}-06-30`;
  const balance=/^30 June (\d{4})$/.exec(header);
  if(balance)return r.periodKind==="instant"&&r.periodStart===null&&r.periodEnd===`${balance[1]}-06-30`;
  const instant=/^At 30 June (\d{4}) \(unaudited\)$/.exec(header);
  if(instant)return r.periodKind==="instant"&&r.periodStart===null&&r.periodEnd===`${instant[1]}-06-30`;
  const annual=/^Year ended 31 December (\d{4})$/.exec(header);
  return !!annual&&r.periodStart===`${annual[1]}-01-01`&&r.periodEnd===`${annual[1]}-12-31`;
}
function sourceUnit(label:string,unit:string):{currency:string;scale:number}|null {
  if(unit==="currency_per_vehicle"&&["RMB per vehicle","RMB/vehicle"].includes(label))return {currency:"CNY",scale:1};
  if(unit==="currency"&&["RMB’000","RMB'000"].includes(label))return {currency:"CNY",scale:1000};
  if(unit==="currency"&&label==="RMB million")return {currency:"CNY",scale:1000000};
  if(unit==="vehicles"&&label==="million units")return {currency:"XXX",scale:1000000};
  if(unit==="vehicles"&&["(Unit)","units"].includes(label))return {currency:"XXX",scale:1};
  if(unit==="shares"&&label==="Number of shares")return {currency:"XXX",scale:1};
  return null;
}
export async function verifyStructuredAssertion(client:PoolClient, materialId:string, request:CreateResearchFundamentalValueRequest,actorId="",confirmedAt=new Date().toISOString()):Promise<"owner_confirmed"|"unverified"|"source_text_verified"> {
  if(request.assertion){
    const provenance=await client.query<{source_url:string|null}>("select ei.source_url from research_materials m join evidence_items ei on ei.id=m.evidence_item_id where m.id=$1",[materialId]);
    const captured=provenance.rows[0]?.source_url??null,a=request.assertion;
    a.ownerSuppliedReferenceUrl=a.sourceUrl&&a.sourceUrl!==captured?a.sourceUrl:null;
    a.capturedSourceUrl=captured;a.sourceUrl=captured??"";
  }
  const b=request.assertion?.textBinding, snapshot=request.assertion?.snapshotTextBinding;
  if(request.assertion?.structureBinding?.taxonomyConfirmedBy!==undefined)throw new ResearchFundamentalError(422,"SERVER_ACTOR_ONLY","taxonomy confirmation actor is generated by the server");
  if(request.assertion?.verification)throw new ResearchFundamentalError(422,"SERVER_VERIFICATION_ONLY","verification metadata is server generated");
  const source = await client.query<{source_type:string;citation_snapshot_id:string|null;citation_snapshot_text_sha256:string|null;
    citation_start_utf16:number|null;citation_end_utf16:number|null;citation_excerpt_sha256:string|null}>(
      `select ei.source_type,m.citation_snapshot_id,m.citation_snapshot_text_sha256,m.citation_start_utf16,
        m.citation_end_utf16,m.citation_excerpt_sha256 from research_materials m
        join evidence_items ei on ei.id=m.evidence_item_id where m.id=$1`,[materialId]);
  const html=source.rows[0]?.source_type==="issuer_public_html";
  if(html && (!snapshot || b))throw new ResearchFundamentalError(422,"SNAPSHOT_TEXT_BINDING_REQUIRED","HTML facts require an exact original-text span");
  if(!html && snapshot)throw new ResearchFundamentalError(422,"DOCUMENT_TEXT_BINDING_REQUIRED","PDF facts cannot cite an HTML snapshot");
  if(snapshot){
    const selected=source.rows[0]!;
    const result=await client.query<{normalized_text:string;text_sha256:string}>(`select s.normalized_text,s.text_sha256
      from research_source_snapshots s where s.id=$1 and s.text_sha256=$2`,[snapshot.snapshotId,snapshot.textSha256]);
    const original=result.rows[0], text=original?.normalized_text;
    if(!original || String(selected.citation_snapshot_id)!==snapshot.snapshotId
      || selected.citation_snapshot_text_sha256!==snapshot.textSha256
      || Number(selected.citation_start_utf16)!==snapshot.startUtf16
      || Number(selected.citation_end_utf16)!==snapshot.endUtf16
      || selected.citation_excerpt_sha256!==snapshot.excerptSha256
      || snapshot.endUtf16>text.length || text.slice(snapshot.startUtf16,snapshot.endUtf16)!==snapshot.sourceExcerpt
      || createHash("sha256").update(snapshot.sourceExcerpt).digest("hex")!==snapshot.excerptSha256
      || !sourceTextMatches(text,snapshot.textSha256,snapshot.sourceExcerpt,snapshot.rawValueText,request.value,request.metric))
      throw new ResearchFundamentalError(422,"ASSERTION_TEXT_MISMATCH","exact HTML source span and numeric transcription could not be verified");
    request.assertion!.verification=verifyAssertionStructure(text,request,"source_text_verified",actorId,confirmedAt);
    return "source_text_verified";
  }
  if(!b){
    const status=request.assertion?.sourceChecked ? "owner_confirmed" : "unverified";
    if(request.assertion)request.assertion.verification=verifyAssertionStructure("",request,status,actorId,confirmedAt);
    return status;
  }
  const result=await client.query<{normalized_text:string;text_sha256:string}>(`select p.normalized_text,p.text_sha256
    from research_materials m join research_document_pages p on p.document_id=m.citation_document_id and p.page_number=m.citation_page_number
    where m.id=$1 and m.citation_document_id=$2 and m.citation_page_number=$3 and m.citation_page_text_sha256=$4 and p.text_sha256=$4`,[materialId,b.documentId,b.pageNumber,b.pageTextSha256]);
  const page=result.rows[0];
  if(!page || !sourceTextMatches(page.normalized_text,page.text_sha256,b.sourceExcerpt,b.rawValueText,request.value,request.metric))
    throw new ResearchFundamentalError(422,"ASSERTION_TEXT_MISMATCH","exact source page, excerpt and numeric transcription could not be verified");
  request.assertion!.verification=verifyAssertionStructure(page.normalized_text,request,"source_text_verified",actorId,confirmedAt);
  return "source_text_verified";
}

function decimalParts(value:string):{integer:bigint;scale:number} {
  const parts=value.split(".");return {integer:BigInt(parts.join("")),scale:parts[1]?.length??0};
}

/** A financial note number before the amount is not the amount; parse the full bound row, not a truncated excerpt. */
function firstRowAmount(region:string,label:string):string|null {
  const escaped=label.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const notes=region.includes("Note Six months")?String.raw`(?: \d{1,2}(?:\([a-z]\))?)?`:"";
  const number=String.raw`(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]+)?`;
  const matches=[...region.matchAll(new RegExp(escaped+notes+String.raw` (\(${number}\)|[+-]?${number}%?)(?![0-9.,%])`,"g"))];
  return matches.length===1?matches[0]![1]!:null;
}
