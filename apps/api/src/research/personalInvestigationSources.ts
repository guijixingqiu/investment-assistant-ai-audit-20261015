import { createHash } from "node:crypto";
import { buildPersonalResearchBrief } from "../routes/personalResearchRoutes.js";
import { buildLightInvestigation, hongKongTradingDate } from "./personalMarketAnomaly.js";
import type { MobileResearchRouteOptions } from "../routes/mobileResearch.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import { readReasoningContext, type ReasoningContext } from "./personalResearchReasoning.js";
import {providerInvestigationSources,type ProviderFinancialValue} from "./personalInvestigationProviderFinance.js";
import { readDeepResearchWorkspace } from "./deepResearchReadRepository.js";
import { readResearchDocumentContent } from "./researchDocumentRepository.js";
import { operatingReasoningMatches } from "../../../../packages/contracts/src/researchOperatingReasoning.js";
import type { OperatingSource } from "../../../../packages/contracts/src/researchOperatingModel.js";
import type { ResearchMaterialData } from "../../../../packages/contracts/src/researchMaterial.js";

export type InvestigationMode = "price_move" | "earnings_quality";
export type InvestigationSource = {
  id: string; symbol: string; source: string; sourceType: "official_pdf" | "official_body" | "provider_financial_statement" | "market_data" | "news_body" | "news_title" | "official_search";
  retrievedAt: string; publishedAt: string | null; confidence: "primary_source" | "attributed_reporting" | "unverified_lead" | "scoped_search";
  readStatus: "BODY_READ" | "LEAD_ONLY" | "SEARCHED_NO_RESULTS" | "UNAVAILABLE";
  text: string; contentSha256: string; url: string | null; pageNumber: number | null; reason: string | null;
  /** Present only when this PDF is already retained in the document library. */
  documentId?: string; documentPdfSha256?: string;
  snapshotCitation?:{snapshotId:string;rawSha256:string;textSha256:string;startUtf16:number;endUtf16:number;
    excerptSha256:string;readStartUtf16:number;readEndUtf16:number;readExcerptSha256:string;readTruncated:boolean};
  providerFinancialValues?:ProviderFinancialValue[];
  providerMaterialSelection?:{captureId:string;financialType:"ANNUAL"|"Q6";periodEnd:string;sourceFingerprint:string;
    materials:Array<{id:string;revision:number;contentFingerprint:string;sourceVersion:string}>};
};
export type InvestigationGap = { reason: "NOT_CONFIGURED" | "SOURCE_UNAVAILABLE" | "NOT_DISCLOSED_IN_READ_SCOPE" | "NOT_CHECKED" | "OWNER_INPUT_REQUIRED" | "INCONCLUSIVE_AFTER_CHECK"; text: string };
export type InvestigationEvidence = {
  symbol: string; membershipId: string; membershipVersion: number; anchorFingerprint: string; fingerprint: string;
  currentQuestion?: string; eventDate?: string; mode: InvestigationMode; sources: InvestigationSource[]; gaps: InvestigationGap[]; summary: string;
  reasoningContext?: ReasoningContext; historyScope?: string;
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const bodyCache = new Map<string, { expiresAt: number; text: string; publishedAt: string | null }>();

export async function collectInvestigationEvidence(options: MobileResearchRouteOptions, id: string,
  actor: AuthenticatedResearchActor, mode: InvestigationMode, eventDate?: string): Promise<InvestigationEvidence | null> {
  const brief = await buildPersonalResearchBrief(options.pool, id, actor, options);
  if (!brief) return null;
  const now = options.now?.() ?? new Date(), retrievedAt = now.toISOString();
  const sources: InvestigationSource[] = brief.sources.map(s => ({ id: s.id, symbol: brief.symbol,
    source: s.title, sourceType: "official_pdf", retrievedAt, publishedAt: s.publishedAt,
    confidence: "primary_source", readStatus: "BODY_READ", text: s.excerpt,
    contentSha256: s.pageTextSha256, url: s.sourceUrl, pageNumber: s.pageNumber, reason: null,
    documentId: s.documentId, documentPdfSha256: brief.latestFinancialDocument?.id === s.documentId
      ? brief.latestFinancialDocument.pdfSha256 : undefined }));
  for(const s of brief.htmlSources??[])sources.push({id:s.id,symbol:brief.symbol,source:s.title,
    sourceType:"official_body",retrievedAt,publishedAt:s.publishedAt,confidence:"primary_source",
    readStatus:"BODY_READ",text:s.excerpt,contentSha256:s.snapshotTextSha256,url:s.sourceUrl,
    pageNumber:null,reason:s.readTruncated
      ? "已按保存的官方网页原字节及正文哈希复核；当前只读取所选片段前部，未读部分不视为未披露。"
      : "已按保存的官方网页原字节及正文哈希复核；所选片段不代表完整财报。",
    snapshotCitation:{snapshotId:s.snapshotId,rawSha256:s.rawSha256,textSha256:s.snapshotTextSha256,
      startUtf16:s.startUtf16,endUtf16:s.endUtf16,excerptSha256:s.excerptSha256,
      readStartUtf16:s.readStartUtf16,readEndUtf16:s.readEndUtf16,
      readExcerptSha256:s.readExcerptSha256,readTruncated:s.readTruncated}});
  const changeSourceGaps = await appendCurrentChangePdfSources(options, id, actor, brief, now, retrievedAt, sources);
  const provider=mode==="earnings_quality"?await providerInvestigationSources(options,id,actor):{sources:[],gaps:[]};
  sources.push(...provider.sources);
  if (mode === "earnings_quality" && brief.latestFinancialDocument) {
    const pages = await options.pool.query<{ page_number: number; normalized_text: string }>(
      "select page_number,normalized_text from research_document_pages where document_id=$1 and page_number=any($2::int[])",
      [brief.latestFinancialDocument.id, sources.filter(s=>s.sourceType==="official_pdf"
        && s.documentId===brief.latestFinancialDocument!.id).map(s => s.pageNumber)]);
    for (const entry of sources) {
      if (entry.sourceType !== "official_pdf" || entry.documentId !== brief.latestFinancialDocument.id) continue;
      const page = pages.rows.find(p => p.page_number === entry.pageNumber);
      if (page) { entry.text = page.normalized_text.slice(0, 12000); entry.reason = page.normalized_text.length > 12000 ? "本页正文较长，当前读取前12000字；未读部分不视为公司未披露。" : "本页正文已完整读取。"; }
    }
    // Read the actual other-gains note in the already validated document, rather than ask the Owner to find it.
    const notes = await options.pool.query<{ page_number: number; normalized_text: string; text_sha256: string }>(
      "select page_number,normalized_text,text_sha256 from research_document_pages where document_id=$1 and normalized_text ilike '%other gains/(losses), net%' and normalized_text ilike '%government grants%' order by page_number limit 1", [brief.latestFinancialDocument.id]);
    for (const note of notes.rows) if (!sources.some(s => s.documentId === brief.latestFinancialDocument!.id
      && s.pageNumber === note.page_number)) sources.push({
      ...source(`S${sources.length + 1}`, brief.symbol, brief.latestFinancialDocument.title, "official_pdf", retrievedAt, note.normalized_text.slice(0, 7000)),
      publishedAt: brief.latestFinancialDocument.publishedAt, pageNumber: note.page_number,
      url: brief.latestFinancialDocument.sourceUrl, contentSha256: note.text_sha256,
      documentId: brief.latestFinancialDocument.id, documentPdfSha256: brief.latestFinancialDocument.pdfSha256 });
  }
  const gaps: InvestigationGap[] = [...provider.gaps, ...changeSourceGaps];
  if (!sources.some(s=>s.sourceType==="official_pdf"||s.sourceType==="official_body"))
    gaps.push({ reason: "SOURCE_UNAVAILABLE", text: "系统尚未取得这只股票可校验的官方财务正文；OpenD 提供商值不能代替发行人原件。" });
  gaps.push({ reason: "NOT_CHECKED", text: "本次聚焦事实与盈利解释，未读取或代填你的估值假设，因此不推算目标价格。" });
  if (mode === "price_move") {
    const light = await buildLightInvestigation(options, id, actor, now, false, eventDate);
    if (!light) gaps.push({ reason: "SOURCE_UNAVAILABLE", text: "没有可绑定的指定日期异常观察，不能将其他日期的行情代入。" });
    else {
      const a = light.anomaly;
      // Preserve the unit from the exact retained quote, not from the stock
      // prefix or today's quote. Older event receipts did not retain currency.
      const currencies = await options.pool.query<{ currency: string }>(
        "select distinct currency from market_quotes where symbol=$1 and quote_time=$2::timestamptz and price=$3 and previous_close=$4",
        [a.symbol, a.quote.quoteTime, a.quote.price, a.quote.previousClose]);
      const code = currencies.rows.length === 1 ? currencies.rows[0]!.currency : undefined;
      const priceUnit = ({ HKD: "港元", CNY: "元人民币", USD: "美元" } as Record<string, string>)[code ?? ""] ?? "";
      if (!priceUnit) gaps.push({ reason: "SOURCE_UNAVAILABLE", text: "已取得指定日价格数值，但未从同一条历史报价核对币种；不能自行补为港元。" });
      sources.push(source("Q", brief.symbol, "Futu OpenD 触发行情", "market_data", retrievedAt,
        `${a.tradingDate} ${a.symbol} 触发时价格 ${a.quote.price}${priceUnit}，前收 ${a.quote.previousClose}${priceUnit}，变化 ${a.quote.changePercent.toFixed(2)}%；报价时点 ${a.quote.quoteTime}。这是触发观察，不是最新价格。`));
      if (a.benchmark) sources.push(source("B", brief.symbol, "恒生指数对照", "market_data", retrievedAt,
        `恒指变化 ${a.benchmark.changePercent.toFixed(2)}%，时点 ${a.benchmark.asOf}。股票触发观察与完成交易日收盘是不同统计时点，不混用两者计算相对差值；指数不能替代同行对照。`));
      await appendVolume(options, light.dailyHistory?.snapshotSha, sources, gaps, brief.symbol, a.tradingDate, retrievedAt, priceUnit);
      gaps.push({ reason: "INCONCLUSIVE_AFTER_CHECK", text: "行业同步波动、行业竞争和公司特异事件须分开判断；读到相关报道不等于证明当天价格变化的因果。" });
    }
  }
  const reasoningContext = await readReasoningContext(options.pool, id, actor, brief.symbol, brief.membershipVersion, now);
  // Old signed answers must be reread after a correctness-policy change; keep
  // their history without letting them enter the current follow-up context.
  const fingerprint = hash(JSON.stringify({ anchor: brief.fingerprint, mode, reasoningContext,
    reasoningSchema: mode === "earnings_quality" ? "personal-research-reasoning-v1.1-report-narrative-blocks-27" : "personal-research-reasoning-v1.1-complete-answer-boundaries-24",
    sources: sources.map(({ retrievedAt: _retrievedAt, ...s }) => s), gaps }));
  return { symbol: brief.symbol, membershipId: brief.membershipId, membershipVersion: brief.membershipVersion, historyScope: brief.historyScope,
    anchorFingerprint: brief.fingerprint, fingerprint, reasoningContext, eventDate: mode === "price_move" ? (eventDate ?? hongKongTradingDate(now)) : undefined, mode, sources, gaps, summary: mode === "price_move" ? sources.find(s => s.id === "Q")?.text ?? "本次尚未取得指定日期的异常观察。" : brief.summary };
}

/** Only the saved PDF pages cited by current facts in the current research change. */
async function appendCurrentChangePdfSources(
  options: MobileResearchRouteOptions, membershipId: string, actor: AuthenticatedResearchActor,
  brief: { symbol: string; membershipVersion: number }, now: Date, retrievedAt: string,
  sources: InvestigationSource[]
): Promise<InvestigationGap[]> {
  const unavailable: InvestigationGap = { reason: "SOURCE_UNAVAILABLE",
    text: "当前经营变化引用的已保存 PDF 原件或页正文未能精确核对；该页未加入可选来源。" };
  try {
    const sourceStore = options.researchDocument ? {
      repositoryRoot: options.researchDocument.repositoryRoot,
      rawStoreRoot: options.researchDocument.rawStoreRoot
    } : undefined;
    const workspace = await readDeepResearchWorkspace(options.pool, membershipId, actor, now, {
      accountScopeId: null, currentPortfolioEnabled: false, currentPortfolioMaxAgeSeconds: 300, sourceStore
    });
    const reasoning = workspace.data?.operatingReasoning;
    const change = reasoning?.researchUpdate?.change;
    if (!change) return [];
    if (!reasoning || workspace.requestedActorId !== actor.actorId
      || workspace.data?.target.membershipId !== membershipId
      || workspace.data.target.membershipVersion !== brief.membershipVersion
      || workspace.data.target.symbol !== brief.symbol
      || !operatingReasoningMatches(reasoning, workspace)) return [unavailable];
    const factIds = new Set(change.changedFactIds);
    const materialIds = new Set(change.sourceIds);
    const facts = reasoning.facts.filter(fact => factIds.has(fact.id)
      && materialIds.has(fact.source.materialId) && "documentId" in fact.source);
    let failed = false;
    for (const fact of facts) {
      const citation = fact.source;
      if (!citation.documentId || !citation.pageNumber || !citation.pageTextSha256
        || !citation.documentPdfSha256) continue;
      const material = workspace.data.materials.find(m => m.id === citation.materialId);
      if (!currentChangeMaterialMatches(material, citation, brief.symbol, now)) {
        failed = true;
        continue;
      }
      if (sources.some(s => s.sourceType === "official_pdf" && s.documentId === citation.documentId
        && s.pageNumber === citation.pageNumber && s.contentSha256 === citation.pageTextSha256
        && s.documentPdfSha256 === citation.documentPdfSha256)) continue;
      try {
        const { document } = await readResearchDocumentContent(options.pool, membershipId,
          citation.documentId, actor, {
            repositoryRoot: options.researchDocument?.repositoryRoot ?? process.cwd(),
            rawStoreRoot: options.researchDocument?.rawStoreRoot
          });
        if (document.symbol !== brief.symbol || document.pdfSha256 !== citation.documentPdfSha256
          || document.publishedAt.slice(0, 10) !== citation.publishedAt.slice(0, 10)
          || !["user_provided", "authorized_public"].includes(document.rightsStatus)) {
          failed = true;
          continue;
        }
        const page = (await options.pool.query<{ normalized_text: string; text_sha256: string }>(
          `select normalized_text,text_sha256 from research_document_pages
            where document_id=$1 and page_number=$2 and text_sha256=$3 limit 1`,
          [citation.documentId, citation.pageNumber, citation.pageTextSha256])).rows[0];
        if (!page?.normalized_text || page.text_sha256 !== citation.pageTextSha256
          || hash(page.normalized_text) !== citation.pageTextSha256) {
          failed = true;
          continue;
        }
        const truncated = page.normalized_text.length > 12000;
        sources.push({ id: `S${sources.length + 1}`, symbol: brief.symbol, source: document.title,
          sourceType: "official_pdf", retrievedAt, publishedAt: document.publishedAt,
          confidence: document.sourceClassification === "authorized_public_issuer_document"
            ? "primary_source" : "unverified_lead", readStatus: "BODY_READ",
          text: page.normalized_text.slice(0, 12000), contentSha256: page.text_sha256,
          url: document.capturedSourceUrl ?? null, pageNumber: citation.pageNumber,
          documentId: document.id, documentPdfSha256: document.pdfSha256,
          reason: truncated
            ? "已核对保存的 PDF 原件及整页哈希；当前只读取前12000字，未读部分不视为未披露；来源核实程度仍以原材料记录为准。"
            : "已核对保存的 PDF 原件及整页哈希；来源核实程度仍以原材料记录为准。" });
      } catch {
        failed = true;
      }
    }
    return failed ? [unavailable] : [];
  } catch {
    return [unavailable];
  }
}

function currentChangeMaterialMatches(material: ResearchMaterialData | undefined,
  citation: OperatingSource, symbol: string, now: Date): boolean {
  return !!material && material.symbol === symbol && material.revision === citation.revision
    && material.contentFingerprint === citation.contentFingerprint
    && material.revisionState === "current" && material.freshness === "fresh"
    && Date.parse(material.validUntil) > now.getTime()
    && ["owner_provided_pdf", "issuer_public_pdf"].includes(material.sourceType)
    && material.citation?.documentId === citation.documentId
    && material.citation?.pageNumber === citation.pageNumber
    && material.citation?.pageTextSha256 === citation.pageTextSha256;
}

export function source(id: string, symbol: string, name: string, type: InvestigationSource["sourceType"], at: string, text: string): InvestigationSource {
  return { id, symbol, source: name, sourceType: type, retrievedAt: at, publishedAt: null, confidence: "primary_source",
    readStatus: "BODY_READ", text, contentSha256: hash(text), url: null, pageNumber: null, reason: null };
}

export async function readAuthorizedNewsBody(url: string, title: string, date: string, fetcher: typeof fetch = fetch): Promise<{ text: string; publishedAt: string | null } | null> {
  const parsed = new URL(url);
  // Only pages returned by the existing authorized Futu source are read. No search provider, arbitrary URL or script execution.
  if (parsed.protocol !== "https:" || parsed.hostname !== "news.futunn.com" || parsed.port || parsed.username || parsed.password
    || !/^\/post\/\d+$/.test(parsed.pathname)) return null;
  const key = `${url}:${title}:${date}`, cached = bodyCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(12000), headers: { "user-agent": "Mozilla/5.0", accept: "text/html" } });
  if (!response.ok || !response.headers.get("content-type")?.includes("text/html") || !response.body) return null;
  const reader = response.body.getReader(); let html = "", size = 0; const decoder = new TextDecoder();
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length;
      if (size > 2_000_000) { await reader.cancel(); return null; } html += decoder.decode(part.value, { stream: true }); }
  } finally { reader.releaseLock(); }
  const pageTitle = plainText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  if (!pageTitle.includes(title.slice(0, 20))) return null;
  const fragment = html.match(/<div[^>]+class=["'][^"']*\borigin_content\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
  const text = plainText(fragment ?? "");
  const publication = html.match(/time:"(20\d\d-\d\d-\d\d \d\d:\d\d)"/)?.[1];
  if (text.length < 100 || !publication || publication.slice(0, 10) !== date || /contentTruncated:(?:true|!0)/.test(html)) return null;
  const value = { text: text.slice(0, 9000), publishedAt: publication.replace(" ", "T") + ":00+08:00", expiresAt: Date.now() + 15 * 60_000 };
  if (bodyCache.size >= 40) bodyCache.delete(bodyCache.keys().next().value!);
  bodyCache.set(key, value); return value;
}
export function plainText(html: string): string {
  return html.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}
async function appendVolume(options: MobileResearchRouteOptions, sha: string | null | undefined, sources: InvestigationSource[], gaps: InvestigationGap[], symbol: string, date: string, at: string, priceUnit: string) {
  if (sha) {
    const rows = await options.pool.query<{ session: string; volume: string; open: string; high: string; low: string; close: string }>("select session::text,volume::text,open::text,high::text,low::text,close::text from market_daily_bars where snapshot_sha=$1 order by session desc limit 6", [sha]);
    if (rows.rows.length === 6 && rows.rows[0].session === date && rows.rows.every(r => Number(r.volume) > 0)) {
      const average = rows.rows.slice(1).reduce((n, r) => n + Number(r.volume), 0) / 5;
      const previousClose = Number(rows.rows[1].close), close = Number(rows.rows[0].close);
      const closingChange = Number.isFinite(previousClose) && previousClose > 0 && Number.isFinite(close)
        ? `收盘涨跌 ${(100 * (close / previousClose - 1)).toFixed(2)}%，可比前收 ${previousClose}${priceUnit}（${rows.rows[1].session}）。` : "尚无可校验的收盘涨跌幅。";
      sources.push(source("V", symbol, "Futu 已完成日线成交量", "market_data", at,
        `${date} 已完成交易日：开盘 ${rows.rows[0].open}${priceUnit}，最高 ${rows.rows[0].high}${priceUnit}，最低 ${rows.rows[0].low}${priceUnit}，收盘 ${rows.rows[0].close}${priceUnit}；${closingChange} 成交量 ${rows.rows[0].volume}股，前五个实际交易日平均 ${average.toFixed(0)}股，比值 ${(Number(rows.rows[0].volume) / average).toFixed(2)} 倍。snapshot ${sha}；只说明成交活跃度，不证明资金动机。`)); return;
    }
  }
  gaps.push({ reason: "SOURCE_UNAVAILABLE", text: "尚未取得当日完整成交量及五个可比交易日；不把不同时点成交量称为放量。" });
}

export function investigationReadingTerms(question: string): string[] {
  const terms: string[] = [];
  if (/重列|比较数字|会计政策|合并|restat|comparative/i.test(question)) terms.push("basis of preparation", "restatement", "pooling", "common control", "comparative figures");
  if (/分部|地区|地域|segment/i.test(question)) terms.push("segment information", "operating segment", "segment results", "geographical");
  if (/核心利润|core profit/i.test(question)) terms.push("core profit attributable");
  if (/汇兑|其他收益|补助|foreign exchange/i.test(question)) terms.push("other gains/(losses), net", "net foreign exchange", "government grants");
  if (/研发|摊销|research and development/i.test(question)) terms.push("research and development costs", "capitalised product development");
  if (/现金流|资本开支|cash flow/i.test(question)) terms.push("statement of cash flows", "total capital expenditures", "financial resources");
  return terms;
}
