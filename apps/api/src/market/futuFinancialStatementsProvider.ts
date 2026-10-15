import type {
  FutuFinancialBridgePage,
  FutuFinancialProviderReport,
  FutuStatementType
} from "../../../../packages/contracts/src/researchFutuFinancialStatement.js";
import {
  FUTU_FINANCIAL_STATEMENT_SOURCE,
  FUTU_STATEMENT_CODE
} from "../../../../packages/contracts/src/researchFutuFinancialStatement.js";

const MAX_PAGE_BYTES = 1_048_576;
const MAX_PAGE_TIMEOUT_MS = 6_000;

export class FutuFinancialPageError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export interface FutuFinancialFetchedPage {
  bytes: Buffer;
  data: FutuFinancialBridgePage;
}

export class FutuFinancialStatementsProvider {
  private readonly baseUrl: URL;

  constructor(baseUrl: string, private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date()) {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
      || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error("Futu financial statements require the configured loopback quote bridge");
    }
    this.baseUrl = parsed;
  }

  async readPage(symbol: string, statementType: FutuStatementType, num: number,
    cursor: string | null, remainingMs: number, financialType:5|7|null=null): Promise<FutuFinancialFetchedPage> {
    if (!/^HK\.[0-9]{5}$/.test(symbol) || !(statementType in FUTU_STATEMENT_CODE)
      || !Number.isSafeInteger(num) || num < 1 || num > 20
      || cursor !== null && (!/^[A-Za-z0-9_,.-]{1,100}$/.test(cursor) || cursor === "-1")) {
      throw new FutuFinancialPageError("INVALID_PROVIDER_REQUEST", "Futu financial page request identity is invalid");
    }
    if (remainingMs <= 0) throw new FutuFinancialPageError("CAPTURE_DEADLINE", "financial capture time limit was reached");
    const url = new URL("/financial-statements", this.baseUrl);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("statementType", String(FUTU_STATEMENT_CODE[statementType]));
    url.searchParams.set("num", String(num));
    if(financialType!==null)url.searchParams.set("financialType",String(financialType));
    if (cursor !== null) url.searchParams.set("nextKey", cursor);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {signal: AbortSignal.timeout(Math.min(MAX_PAGE_TIMEOUT_MS, remainingMs))});
    } catch {
      throw new FutuFinancialPageError("BRIDGE_UNAVAILABLE", "Futu quote bridge did not return a financial page");
    }
    if (!response.ok) throw new FutuFinancialPageError("BRIDGE_HTTP_ERROR", `Futu quote bridge returned HTTP ${response.status}`);
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_PAGE_BYTES)
      throw new FutuFinancialPageError("PAGE_TOO_LARGE", "Futu financial page exceeds the bounded byte limit");
    const bytes = await boundedBody(response);
    let data: unknown;
    try { data = JSON.parse(bytes.toString("utf8")); }
    catch { throw new FutuFinancialPageError("PAGE_INVALID_JSON", "Futu financial page is not valid JSON"); }
    if (!validBridgePage(data, symbol, FUTU_STATEMENT_CODE[statementType], num, cursor, this.now(),financialType))
      throw new FutuFinancialPageError("PAGE_IDENTITY_INVALID", "Futu financial page identity or fields are invalid");
    return {bytes, data};
  }
}

async function boundedBody(response: Response): Promise<Buffer> {
  if (!response.body) throw new FutuFinancialPageError("PAGE_EMPTY", "Futu financial page has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_PAGE_BYTES) {
        await reader.cancel();
        throw new FutuFinancialPageError("PAGE_TOO_LARGE", "Futu financial page exceeds the bounded byte limit");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!total) throw new FutuFinancialPageError("PAGE_EMPTY", "Futu financial page is empty");
  return Buffer.concat(chunks, total);
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function realDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validReport(value: unknown): value is FutuFinancialProviderReport {
  if (!record(value) || !realDay(value.date_time_str)
    || !Number.isSafeInteger(value.date_time) || Number(value.date_time) <= 0
    || !Number.isSafeInteger(value.fiscal_year) || Number(value.fiscal_year) < 1900 || Number(value.fiscal_year) > 2100
    || typeof value.financial_type !== "string" || value.financial_type.length < 1 || value.financial_type.length > 40
    || typeof value.period_text !== "string" || value.period_text.length < 1 || value.period_text.length > 80
    || typeof value.currency_code !== "string" || !/^[A-Z]{3}$/.test(value.currency_code)
    || typeof value.currency_info !== "string" || value.currency_info.length > 80
    || typeof value.accounting_standards !== "string" || value.accounting_standards.length > 200
    || typeof value.auditor_report !== "string" || value.auditor_report.length > 500
    || !Array.isArray(value.item_list) || value.item_list.length > 1_000) return false;
  const ids = new Set<number>();
  for (const item of value.item_list) {
    if (!record(item) || !Number.isSafeInteger(item.field_id) || Number(item.field_id) < 0
      || ids.has(Number(item.field_id)) || typeof item.display_name !== "string"
      || item.display_name.length < 1 || item.display_name.length > 300
      || !finiteOrNull(item.data) || item.yoy !== undefined && !finiteOrNull(item.yoy)
      || item.qoq !== undefined && !finiteOrNull(item.qoq)) return false;
    ids.add(Number(item.field_id));
  }
  return true;
}

function finiteOrNull(value: unknown): boolean {
  return value === null || typeof value === "number" && Number.isFinite(value);
}

export function validBridgePage(value: unknown, symbol: string, statementCode: 1 | 2 | 3,
  num: number, cursor: string | null, now = new Date(),financialType:5|7|null=null): value is FutuFinancialBridgePage {
  if (!record(value) || value.ok !== true || value.source !== FUTU_FINANCIAL_STATEMENT_SOURCE
    || value.symbol !== symbol || value.statement_type !== statementCode
    || (financialType===null ? value.requested_financial_type!==undefined&&value.requested_financial_type!==null
      : value.requested_financial_type!==financialType)
    || value.requested_next_key !== cursor || value.num !== num
    || typeof value.captured_at !== "string" || !Number.isFinite(Date.parse(value.captured_at))
    || Date.parse(value.captured_at) > now.getTime() + 1_000
    || !Array.isArray(value.structure_list) || value.structure_list.length > 1_000
    || !Array.isArray(value.report_list) || value.report_list.length > num
    || typeof value.next_key !== "string" || !/^(?:-1|[A-Za-z0-9_,.-]{1,100})$/.test(value.next_key)
    || !value.report_list.every(validReport)
    || financialType!==null&&value.report_list.some(report=>report.financial_type!==(financialType===7?"ANNUAL":"Q6"))) return false;
  return true;
}
