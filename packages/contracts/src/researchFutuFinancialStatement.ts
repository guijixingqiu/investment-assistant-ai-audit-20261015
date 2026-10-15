import {isRfc3339DateTime} from "./factMetadata.js";
export const FUTU_FINANCIAL_STATEMENT_SOURCE = "futu_opend_financial_statement_provider" as const;
export const FUTU_STATEMENT_TYPES = ["income", "balance_sheet", "cash_flow"] as const;
export type FutuStatementType = typeof FUTU_STATEMENT_TYPES[number];
export type FutuCaptureStatus = "complete" | "partial" | "unavailable";
export type FutuOriginalAvailability = "available" | "unavailable" | "unknown";
export type FutuFinancialPeriodSelection = "legacy_default" | "annual" | "half_year";
export const FUTU_FINANCIAL_PERIOD_CODE = {annual:7,half_year:5} as const;

export const FUTU_STATEMENT_CODE: Record<FutuStatementType, 1 | 2 | 3> = {
  income: 1,
  balance_sheet: 2,
  cash_flow: 3
};

export interface CaptureFutuFinancialStatementsRequest {
  membershipVersion: number;
  pageSize: number;
  maxPagesPerTable: number;
  userRequested: true;
  idempotencyKey: string;
  periodSelection?: "annual" | "half_year";
}

export interface FutuFinancialReportSummary {
  periodEnd: string;
  periodText: string;
  financialType: string;
  fiscalYear: number;
  currencyCode: string;
  accountingStandards: string;
  itemCount: number;
  reportSha256: string;
}

export interface FutuFinancialPageData {
  id: string;
  captureId: string;
  statementType: FutuStatementType;
  pageNumber: number;
  requestedCursor: string | null;
  nextCursor: string;
  capturedAt: string;
  rawSha256: string;
  byteLength: number;
  reports: FutuFinancialReportSummary[];
  originalAvailability: FutuOriginalAvailability;
}

export interface FutuFinancialTableState {
  status: FutuCaptureStatus;
  reasonCode: string | null;
  pageCount: number;
  reportCount: number;
  requestPaginationComplete: boolean;
  lastNextCursor: string | null;
  currentOriginalsAvailable: boolean | null;
}

export type FutuFinancialTableStates = Record<FutuStatementType, FutuFinancialTableState>;

/** These unknowns cannot be inferred from the SDK's period label or decimal values. */
export const FUTU_FINANCIAL_UNKNOWNS = {
  periodStart: "UNKNOWN",
  amountUnitScale: "UNKNOWN",
  consolidationScope: "UNKNOWN",
  restatementStatus: "UNKNOWN",
  issuerOriginal: "UNKNOWN",
  latestRequiredPeriod: "UNKNOWN",
  historicalCoverage: "UNKNOWN"
} as const;

export interface FutuFinancialCaptureData {
  id: string;
  membershipId: string;
  membershipVersion: number;
  actorType: "user";
  actorId: string;
  symbol: string;
  sourceClassification: typeof FUTU_FINANCIAL_STATEMENT_SOURCE;
  capturedAt: string;
  pageSize: number;
  maxPagesPerTable: number;
  periodSelection: FutuFinancialPeriodSelection;
  tables: FutuFinancialTableStates;
  pages: FutuFinancialPageData[];
  unknowns: typeof FUTU_FINANCIAL_UNKNOWNS;
}

export interface FutuFinancialProviderItem {
  field_id: number;
  display_name: string;
  data: number | null;
  yoy?: number | null;
  qoq?: number | null;
}

export interface FutuFinancialProviderReport {
  date_time: number;
  date_time_str: string;
  fiscal_year: number;
  financial_type: string;
  period_text: string;
  currency_code: string;
  currency_info: string;
  accounting_standards: string;
  auditor_report: string;
  item_list: FutuFinancialProviderItem[];
}

export interface FutuFinancialBridgePage {
  ok: true;
  source: typeof FUTU_FINANCIAL_STATEMENT_SOURCE;
  symbol: string;
  statement_type: 1 | 2 | 3;
  requested_financial_type?: 5 | 7 | null;
  requested_next_key: string | null;
  num: number;
  captured_at: string;
  structure_list: unknown[];
  report_list: FutuFinancialProviderReport[];
  next_key: string;
}

/** Provider originals only. These values are not issuer-verified fundamentals or formal coverage. */
export interface FutuFinancialHistoryValue {
  metric:"revenue"|"profit_attributable_to_owners"|"operating_cash_flow"|"total_assets"|"total_liabilities";
  statementType:FutuStatementType;
  fieldId:number;
  displayName:string;
  rawValue:string;
  currencyCode:string;
  periodKind:"duration"|"instant";
  periodStart:string|null;
  periodEnd:string;
  periodText:string;
  financialType:"ANNUAL"|"Q6";
  source:{captureId:string;pageId:string;rawSha256:string;reportSha256:string;capturedAt:string};
}

export interface FutuFinancialHistoryData {
  symbol:string;membershipId:string;membershipVersion:number;sourceClassification:typeof FUTU_FINANCIAL_STATEMENT_SOURCE;
  status:"available"|"partial"|"unavailable";
  annualCaptureId:string|null;halfYearCaptureId:string|null;
  annualPeriodEnds:string[];halfYearPeriodEnds:string[];latestHalfYearPeriodEnd:string|null;
  values:FutuFinancialHistoryValue[];gaps:string[];
  captureLimitations:string[];observedCurrencyCode:string|null;
  comparisonNotices:Array<{id:string;text:string;sourceUrl:string;periodEnds:string[]}>;
  issuerOriginalVerification:"UNKNOWN";restatementComparability:"UNKNOWN";latestRequiredFiling:"UNKNOWN";
}

export interface FutuFinancialMaterialSource {
  captureId:string;membershipId:string;membershipVersion:number;symbol:string;capturedAt:string;
  financialType:"ANNUAL"|"Q6";periodEnd:string;sourceFingerprint:string;
  pages:Array<{pageId:string;statementType:FutuStatementType;rawSha256:string;reportSha256:string}>;
  rows:Array<Omit<FutuFinancialHistoryValue,"rawValue"|"source">>;gaps:string[];
  amountUnit:"currency_base_unit";amountUnitScale:1;
  publicationTime:"UNKNOWN";issuerOriginalVerification:"UNKNOWN";restatementComparability:"UNKNOWN";
}
export interface FutuFinancialMaterialPreview {
  source:FutuFinancialMaterialSource;title:string;contentText:string;summary:string;
  values:FutuFinancialHistoryValue[];
  contentFingerprint:string;sourceVersion:string;
  materials:Array<{id:string;revision:number;contentFingerprint:string;sourceVersion:string}>;
}
export interface CreateFutuFinancialMaterialRequest {
  membershipVersion:number;financialType:"ANNUAL"|"Q6";periodEnd:string;
  sourceFingerprint:string;validUntil:string;userConfirmed:true;idempotencyKey:string;
}
export function validFutuFinancialMaterialSource(value:unknown):value is FutuFinancialMaterialSource {
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const s=value as FutuFinancialMaterialSource;
  return /^[1-9]\d*$/.test(s.captureId)&&/^[1-9]\d*$/.test(s.membershipId)
    && Number.isSafeInteger(s.membershipVersion)&&s.membershipVersion>0&&/^HK\.\d{5}$/.test(s.symbol)
    && Number.isFinite(Date.parse(s.capturedAt))&&["ANNUAL","Q6"].includes(s.financialType)
    && /^20\d{2}-\d{2}-\d{2}$/.test(s.periodEnd)&&/^[a-f0-9]{64}$/.test(s.sourceFingerprint)
    && s.amountUnit==="currency_base_unit"&&s.amountUnitScale===1
    && s.publicationTime==="UNKNOWN"&&s.issuerOriginalVerification==="UNKNOWN"&&s.restatementComparability==="UNKNOWN"
    && Array.isArray(s.pages)&&s.pages.length>=1&&s.pages.length<=3
    && s.pages.every(p=>/^[1-9]\d*$/.test(p.pageId)&&FUTU_STATEMENT_TYPES.includes(p.statementType)
      && /^[a-f0-9]{64}$/.test(p.rawSha256)&&/^[a-f0-9]{64}$/.test(p.reportSha256))
    && Array.isArray(s.rows)&&s.rows.length>0&&s.rows.length<=5
    && s.rows.every(v=>v.periodEnd===s.periodEnd&&v.financialType===s.financialType
      && s.pages.some(p=>p.statementType===v.statementType))
    && Array.isArray(s.gaps)&&s.gaps.every(g=>typeof g==="string"&&g.length<=1000);
}
export function validCreateFutuFinancialMaterialRequest(value:unknown):value is CreateFutuFinancialMaterialRequest {
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  return Object.keys(v).sort().join()==="financialType,idempotencyKey,membershipVersion,periodEnd,sourceFingerprint,userConfirmed,validUntil"
    && Number.isSafeInteger(v.membershipVersion)&&Number(v.membershipVersion)>0
    && ["ANNUAL","Q6"].includes(String(v.financialType))
    && /^20\d{2}-\d{2}-\d{2}$/.test(String(v.periodEnd))
    && /^[a-f0-9]{64}$/.test(String(v.sourceFingerprint))
    && typeof v.validUntil==="string"&&isRfc3339DateTime(v.validUntil)&&Number.isFinite(Date.parse(v.validUntil))
    && v.userConfirmed===true&&typeof v.idempotencyKey==="string"&&v.idempotencyKey.length>0&&v.idempotencyKey.length<=200;
}

export function validCaptureFutuFinancialStatementsRequest(value: unknown): value is CaptureFutuFinancialStatementsRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return Object.keys(request).sort().join() === ["membershipVersion", "pageSize", "maxPagesPerTable", "userRequested", "idempotencyKey",...(request.periodSelection===undefined?[]:["periodSelection"])].sort().join()
    && Number.isSafeInteger(request.membershipVersion) && Number(request.membershipVersion) > 0
    && Number.isSafeInteger(request.pageSize) && Number(request.pageSize) >= 1 && Number(request.pageSize) <= 20
    && Number.isSafeInteger(request.maxPagesPerTable) && Number(request.maxPagesPerTable) >= 1 && Number(request.maxPagesPerTable) <= 4
    && request.userRequested === true
    && (request.periodSelection===undefined || request.periodSelection==="annual" || request.periodSelection==="half_year")
    && typeof request.idempotencyKey === "string" && request.idempotencyKey.length >= 1 && request.idempotencyKey.length <= 200;
}
