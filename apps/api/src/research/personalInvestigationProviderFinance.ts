import {createHash} from "node:crypto";
import type {MobileResearchRouteOptions} from "../routes/mobileResearch.js";
import type {AuthenticatedResearchActor} from "./domain.js";
import type {FutuFinancialHistoryValue} from "../../../../packages/contracts/src/researchFutuFinancialStatement.js";
import {safeProviderDecimal} from "../../../../packages/contracts/src/researchFutuFinancialHistory.js";
import {normalizedAmountKey} from "../../../../packages/contracts/src/researchFactIdentity.js";
import type {InvestigationGap,InvestigationSource} from "./personalInvestigationSources.js";
import {readFutuFinancialHistory,futuFinancialPeriodFingerprint,readFutuFinancialMaterialMatches} from "./researchFutuFinancialStatementRepository.js";

export const providerMetricTitles:Record<FutuFinancialHistoryValue["metric"],string>={
  revenue:"营业总收入",profit_attributable_to_owners:"归母净利润",
  operating_cash_flow:"经营现金流净额",total_assets:"总资产",total_liabilities:"总负债"};
const currencyNames:Record<string,string>={CNY:"人民币元",HKD:"港元",USD:"美元"};
const sha=(text:string)=>createHash("sha256").update(text).digest("hex");
export function providerValueLine(value:FutuFinancialHistoryValue):string {
  const currency=currencyNames[value.currencyCode];
  if(!currency)return `${providerMetricTitles[value.metric]}：币种 ${value.currencyCode||"未知"}，原值仅在已保存捕获中查看（币种未支持量化引用）。`;
  const raw=safeProviderDecimal(value.rawValue);
  if(raw===null)
    return `${providerMetricTitles[value.metric]}：${value.rawValue} ${currency}（金额原值待核对，暂不量化引用）。`;
  const scale=currency==="人民币元"?"亿元":currency==="港元"?"亿港元":"亿美元";
  return `${providerMetricTitles[value.metric]}：${value.rawValue} ${currency}`
    +`（${normalizedAmountKey(raw,"0.00000001")}${scale}）`
    +`（${value.statementType}:${value.fieldId}）。`;
}

export type ProviderFinancialValue=FutuFinancialHistoryValue & {quote:string};
export type ProviderInvestigationResult={sources:InvestigationSource[];gaps:InvestigationGap[]};

/** Saved provider originals only; read failures and incomplete periods remain visible. */
export async function providerInvestigationSources(options:MobileResearchRouteOptions,membershipId:string,
  actor:AuthenticatedResearchActor):Promise<ProviderInvestigationResult> {
  const unavailable=(text:string):ProviderInvestigationResult=>({sources:[],gaps:[{reason:"SOURCE_UNAVAILABLE",text}]});
  if(!options.researchDocument)return unavailable("OpenD 财报读取未配置，提供商历史不可用。");
  let history;
  try{history=await readFutuFinancialHistory(options.pool,membershipId,actor,{repositoryRoot:options.researchDocument.repositoryRoot,
    rawStoreRoot:options.researchDocument.rawStoreRoot});}
  catch{return unavailable("OpenD 已保存财报历史读取或原件核验失败；本次没有可引用的提供商值。");}
  const periods=[...history.annualPeriodEnds.map(end=>({end,type:"ANNUAL"})),
    ...history.halfYearPeriodEnds.map(end=>({end,type:"Q6"}))];
  const sources:InvestigationSource[]=periods.flatMap(({end,type})=>{
    const values=history.values.filter(value=>value.periodEnd===end&&value.financialType===type);
    if(!values.length)return [];
    const label=type==="ANNUAL"?`${end.slice(0,4)}/FY`:`${end.slice(0,4)}/H1`;
    const providerFinancialValues=values.map(value=>({...value,quote:providerValueLine(value)}));
    const text=`OpenD 提供商财报，${history.symbol}，期间 ${label}（${end.slice(0,4)}-01-01 至 ${end}；资产负债为期末时点），币种以逐项原始响应为准。${providerFinancialValues.map(value=>value.quote).join(" ")} 最近目标范围${history.status==="available"?`五项同币种已读齐（${history.observedCurrencyCode}）`:"仍有缺项或口径冲突"}；同币种不等于发行人核验或跨期重述可比。`;
    const originalRefs=[...new Set(values.map(value=>`${value.statementType} 页${value.source.pageId} SHA-256 ${value.source.rawSha256}`))];
    return [{id:`FUTU_${type}_${end.replaceAll("-","")}`,symbol:history.symbol,source:`OpenD 提供商财报 · ${label}`,
      sourceType:"provider_financial_statement" as const,retrievedAt:values[0]!.source.capturedAt,publishedAt:null,
      confidence:"attributed_reporting" as const,readStatus:"BODY_READ" as const,text,
      contentSha256:sha(text),url:null,pageNumber:null,providerFinancialValues,
      providerMaterialSelection:{captureId:values[0]!.source.captureId,financialType:type as "ANNUAL"|"Q6",
        periodEnd:end,sourceFingerprint:futuFinancialPeriodFingerprint(values),materials:[]},
      reason:`提供商原始响应已核验；不是发行人原文、正式财务事实或跨期可比结论。${originalRefs.join("；")}${history.captureLimitations.length?`；整次捕获另有历史限制：${history.captureLimitations.slice(0,3).join("；")}`:""}`}];
  });
  const gaps:InvestigationGap[]=history.gaps.map(text=>({reason:"SOURCE_UNAVAILABLE",text:`OpenD 提供商历史待补：${text}`}));
  for(const source of sources){
    const selection=source.providerMaterialSelection!;
    try{selection.materials=await readFutuFinancialMaterialMatches(options.pool,membershipId,actor,
      selection.sourceFingerprint,options.now?.());}
    catch{gaps.push({reason:"SOURCE_UNAVAILABLE",text:`OpenD ${selection.periodEnd} 的正式材料匹配暂无法读取；提供商原值仍可阅读，本次不自动选入材料。`});}
  }
  if(!sources.length&&!gaps.length)gaps.push({reason:"SOURCE_UNAVAILABLE",text:"OpenD 已保存财报历史没有可引用的五项核心值。"});
  const unsupported=[...new Set(history.values.filter(value=>!currencyNames[value.currencyCode]).map(value=>value.currencyCode))];
  for(const code of unsupported)gaps.push({reason:"INCONCLUSIVE_AFTER_CHECK",text:`OpenD 币种 ${code||"未知"} 未支持量化引用；原始值可查看，不换算成人民币。`});
  return {sources,gaps};
}
