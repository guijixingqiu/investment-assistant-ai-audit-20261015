import {FUTU_STATEMENT_CODE,type FutuFinancialBridgePage,type FutuFinancialHistoryValue,type FutuStatementType} from "./researchFutuFinancialStatement.js";
import {normalizedAmountKey} from "./researchFactIdentity.js";

/** Field IDs are scoped by statement type; an unknown name or period is not a financial value. */
const coreFields = [
  {metric:"revenue",statementType:"income",fieldId:5001,displayName:"营业总收入",periodKind:"duration"},
  {metric:"profit_attributable_to_owners",statementType:"income",fieldId:5051,displayName:"归属母公司净利润",periodKind:"duration"},
  {metric:"operating_cash_flow",statementType:"cash_flow",fieldId:5001,displayName:"经营活动现金流量净额",periodKind:"duration"},
  {metric:"total_assets",statementType:"balance_sheet",fieldId:5001,displayName:"资产合计",periodKind:"instant"},
  {metric:"total_liabilities",statementType:"balance_sheet",fieldId:5060,displayName:"负债合计",periodKind:"instant"}
] as const;

export function projectFutuFinancialHistoryValues(page:FutuFinancialBridgePage,selection:"annual"|"half_year",
  source:{captureId:string;pageId:string;rawSha256:string;capturedAt:string;reportSha256s:string[]}):FutuFinancialHistoryValue[] {
  const statementType=(Object.keys(FUTU_STATEMENT_CODE) as FutuStatementType[]).find(type=>FUTU_STATEMENT_CODE[type]===page.statement_type);
  if(!statementType||page.requested_financial_type!==(selection==="annual"?7:5))return [];
  const fields=coreFields.filter(field=>field.statementType===statementType);
  return page.report_list.flatMap((report,index)=>{
    const year=Number(report.date_time_str.slice(0,4));
    const annual=selection==="annual",suffix=annual?"-12-31":"-06-30";
    if(!Number.isSafeInteger(year)||year<2000||year>2100||report.date_time_str!==`${year}${suffix}`
      ||report.fiscal_year!==year||report.financial_type!==(annual?"ANNUAL":"Q6")
      ||report.period_text!==`${year}/${annual?"FY":"H1"}`
      ||!/^[a-f0-9]{64}$/.test(source.reportSha256s[index]??""))return [];
    return fields.flatMap(field=>{
      const structure=page.structure_list.filter((item):item is {field_id:number;display_name:string}=>
        !!item&&typeof item==="object"&&"field_id" in item&&"display_name" in item
        &&item.field_id===field.fieldId&&item.display_name===field.displayName);
      const values=report.item_list.filter(item=>item.field_id===field.fieldId&&item.display_name===field.displayName);
      if(structure.length!==1||values.length!==1)return [];
      const rawValue=safeProviderDecimal(values[0]!.data);
      if(rawValue===null)return [];
      return [{metric:field.metric,statementType,fieldId:field.fieldId,displayName:field.displayName,
        rawValue,currencyCode:report.currency_code,periodKind:field.periodKind,
        periodStart:field.periodKind==="duration"?`${year}-01-01`:null,periodEnd:report.date_time_str,
        periodText:report.period_text,financialType:report.financial_type as "ANNUAL"|"Q6",
        source:{captureId:source.captureId,pageId:source.pageId,rawSha256:source.rawSha256,
          capturedAt:source.capturedAt,reportSha256:source.reportSha256s[index]!}}];
    });
  });
}

/** Accept a retained raw value only when conversion back to a number keeps its exact decimal text. */
export function safeProviderDecimal(value:number|string|null):string|null {
  if(typeof value!=="number"&&typeof value!=="string")return null;
  if(typeof value==="number"&&!Number.isFinite(value))return null;
  try {
    const decimal=normalizedAmountKey(value,1);
    // Keep the provider's decimal value, including its fractional digits. A
    // scaled decimal outside JS's safe integer range cannot retain those digits.
    const digits=decimal.replace(/^-/,"").replace(".","").replace(/^0+/,"")||"0";
    if(BigInt(digits)>BigInt(Number.MAX_SAFE_INTEGER))return null;
    if(typeof value==="string"&&(value!==decimal||normalizedAmountKey(Number(decimal),1)!==decimal))return null;
    return decimal;
  } catch {return null;}
}
