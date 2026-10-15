/** OpenD observations are third-party research references, never issuer facts or fair-value claims. */
export const FUTU_VALUATION_SOURCE = "futu_opend_valuation_provider" as const;
export type FutuValuationType = "PE" | "PB";

export interface FutuValuationHistoricalItem {
  value:number;time:number;time_str:string;plate_value:number|null;
}
export interface FutuValuationBridge {
  ok:true;source:typeof FUTU_VALUATION_SOURCE;symbol:string;
  valuation_type:FutuValuationType;interval_type:"YEAR_5";captured_at:string;
  data:{valuation_type:FutuValuationType;last_update_time:number;last_update_time_str:string;
    trend:{current_value:number;average_value:number;valuation_percentile:number;
      avg_minus_1_stddev:number|null;avg_plus_1_stddev:number|null;
      historical_items:FutuValuationHistoricalItem[]};
    [key:string]:unknown};
}

export interface FutuValuationCapture {
  id:string;membershipId:string;membershipVersion:number;symbol:string;
  valuationType:FutuValuationType;intervalType:"YEAR_5";
  capturedAt:string;providerUpdatedAt:string;rawSha256:string;byteLength:number;
  currentValue:number;historicalAverage:number;historicalPercentile:number;
  historicalCount:number;firstHistoricalDate:string;lastHistoricalDate:string;
  originalAvailability:"available"|"unavailable";
}

export interface FutuAnnualEpsReference {
  financialCaptureId:string;pageId:string;rawSha256:string;reportSha256:string;
  periodEnd:string;fiscalYear:number;accountingStandards:string;capturedAt:string;
  currencyCode:string;basis:"basic"|"diluted";fieldId:5054|5055;rawValue:string;
}

export interface FutuProviderValuationBasis {
  kind:"provider";sourceClassification:"third_party_statement";
  membershipId:string;membershipVersion:number;symbol:string;
  sourceMaterialId:string;sourceMaterialRevision:number;sourceMaterialFingerprint:string;
  eps:FutuAnnualEpsReference;
  valuation:{captureId:string;rawSha256:string;valuationType:"PE";intervalType:"YEAR_5";
    capturedAt:string;providerUpdatedAt:string;currentValue:number;historicalAverage:number;
    historicalPercentile:number;historicalCount:number;firstHistoricalDate:string;lastHistoricalDate:string};
  issuerOriginalVerification:"UNKNOWN";restatementComparability:"UNKNOWN";
  publicationTime:"UNKNOWN";currencyConversion:"NONE";
}

export interface FutuProviderValuationPreview {
  basis:FutuProviderValuationBasis;sourceFingerprint:string;
  methodId:"discounted_forward_metric_multiple_user_scenario";
  proposed:{metricCurrency:string;baseMetricPerShare:number;terminalMultipleReference:number;
    historicalEpsGrowthReferences:Array<{fromYear:number;toYear:number;rate:number}>};
  limitations:string[];
}

export interface CreateFutuValuationCaptureRequest {
  membershipVersion:number;valuationType:FutuValuationType;idempotencyKey:string;
}

export function validCreateFutuValuationCaptureRequest(value:unknown):value is CreateFutuValuationCaptureRequest {
  return object(value)&&Object.keys(value).sort().join(",")==="idempotencyKey,membershipVersion,valuationType"
    &&Number.isSafeInteger(value.membershipVersion)&&value.membershipVersion>0
    &&["PE","PB"].includes(value.valuationType)
    &&typeof value.idempotencyKey==="string"&&value.idempotencyKey.length>=1&&value.idempotencyKey.length<=200;
}

export interface CreateFutuProviderValuationScenarioRequest {
  membershipVersion:number;symbol:string;financialCaptureId:string;annualPeriodEnd:string;
  epsBasis:"basic"|"diluted";valuationCaptureId:string;sourceMaterialId:string;
  proposalFingerprint:string;replacesScenarioSetId:string|null;
  assumptions:import("./annualValuationQuantWorkbench.js").AnnualValuationScenarioInput;
  ownerConfirmed:true;idempotencyKey:string;
}

export function validCreateFutuProviderValuationScenarioRequest(value:unknown):value is CreateFutuProviderValuationScenarioRequest {
  return object(value)&&Object.keys(value).sort().join(",")==="annualPeriodEnd,assumptions,epsBasis,financialCaptureId,idempotencyKey,membershipVersion,ownerConfirmed,proposalFingerprint,replacesScenarioSetId,sourceMaterialId,symbol,valuationCaptureId"
    &&Number.isSafeInteger(value.membershipVersion)&&value.membershipVersion>0
    &&typeof value.symbol==="string"&&/^HK\.\d{5}$/.test(value.symbol)
    &&["financialCaptureId","valuationCaptureId","sourceMaterialId"].every(key=>typeof value[key]==="string"&&/^[1-9]\d*$/.test(value[key]))
    &&typeof value.annualPeriodEnd==="string"&&/^20\d{2}-12-31$/.test(value.annualPeriodEnd)
    &&["basic","diluted"].includes(value.epsBasis)
    &&typeof value.proposalFingerprint==="string"&&/^[a-f0-9]{64}$/.test(value.proposalFingerprint)
    &&(value.replacesScenarioSetId===null||typeof value.replacesScenarioSetId==="string"&&/^[1-9]\d*$/.test(value.replacesScenarioSetId))
    &&value.ownerConfirmed===true&&typeof value.idempotencyKey==="string"
    &&value.idempotencyKey.length>=1&&value.idempotencyKey.length<=200;
}

export function validFutuValuationBridge(value:unknown,symbol:string,type:FutuValuationType,now=new Date()):value is FutuValuationBridge {
  if(!object(value)||value.ok!==true||value.source!==FUTU_VALUATION_SOURCE||value.symbol!==symbol
    ||value.valuation_type!==type||value.interval_type!=="YEAR_5"
    ||!dateTime(value.captured_at)||Date.parse(value.captured_at)>now.getTime()+1000
    ||!object(value.data)||value.data.valuation_type!==type
    ||!Number.isSafeInteger(value.data.last_update_time)
    ||Number(value.data.last_update_time)<=0
    ||Number(value.data.last_update_time)*1000>now.getTime()+1000
    ||typeof value.data.last_update_time_str!=="string"
    ||!object(value.data.trend))return false;
  const trend=value.data.trend;
  if(!positive(trend.current_value)||!positive(trend.average_value)
    ||typeof trend.valuation_percentile!=="number"||!Number.isFinite(trend.valuation_percentile)
    ||trend.valuation_percentile<0||trend.valuation_percentile>100
    ||!Array.isArray(trend.historical_items)
    ||trend.historical_items.length<2||trend.historical_items.length>1600)return false;
  let previous="";
  for(const item of trend.historical_items){
    if(!object(item)||!positive(item.value)||!Number.isSafeInteger(item.time)
      ||!day(item.time_str)||item.time_str<=previous
      ||item.plate_value!==null&&!positive(item.plate_value))return false;
    previous=item.time_str;
  }
  const first=trend.historical_items[0].time_str;
  return Date.parse(`${previous}T00:00:00Z`)-Date.parse(`${first}T00:00:00Z`)>=4*365*86400000
    &&Date.parse(`${previous}T00:00:00Z`)<=now.getTime()+86400000;
}

function object(value:unknown):value is Record<string,any>{return !!value&&typeof value==="object"&&!Array.isArray(value);}
function positive(value:unknown):value is number{return typeof value==="number"&&Number.isFinite(value)&&value>0;}
function dateTime(value:unknown):value is string{return typeof value==="string"&&Number.isFinite(Date.parse(value));}
function day(value:unknown):value is string{
  if(typeof value!=="string"||!/^20\d{2}-\d{2}-\d{2}$/.test(value))return false;
  const time=Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;
}
