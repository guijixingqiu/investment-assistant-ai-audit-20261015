import { createHash } from "node:crypto";
import {
  MARKET_DISCOVERY_QUALIFICATION_SCHEMA_VERSION,
  MARKET_DISCOVERY_MAX_AGE_MS,
  unavailableCandidateDiscovery,
  unavailableNoticeLeads,
  unavailableOfficialAnnouncements,
  type CandidateDiscoveryLane,
  type MarketDiscoveryCandidate,
  type MarketDiscoveryQualificationEnvelope,
  type MarketDiscoveryQualificationFact,
  type NoticeLeadDiscoveryLane,
  type OfficialAnnouncementDiscoveryItem,
  type OfficialAnnouncementDiscoveryLane,
  type QualifyMarketDiscoveryCandidateRequest
} from "../../../../packages/contracts/src/marketDiscovery.js";
import type { HkConnectUniverse } from "./hkConnectUniverse.js";
export interface MarketDiscoveryProvider {
  read(symbol?: string): Promise<CandidateDiscoveryLane>;
}
export interface OfficialAnnouncementProvider {
  read(symbol: string, publicationDate?: string): Promise<OfficialAnnouncementDiscoveryLane>;
}
export interface NoticeLeadProvider {
  read(symbol: string, limit?: number): Promise<NoticeLeadDiscoveryLane>;
}
export class FutuHttpMarketDiscoveryProvider implements MarketDiscoveryProvider {
  private marketRead: { expiresAt: number; pending: Promise<CandidateDiscoveryLane> } | null = null;
  constructor(
    private readonly baseUrl: string,
    private readonly universe: HkConnectUniverse,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date()
  ) {}

  async read(symbol?: string): Promise<CandidateDiscoveryLane> {
    if (symbol) return this.fetchLane(symbol);
    if (this.marketRead && this.marketRead.expiresAt > this.now().getTime()) return this.marketRead.pending;
    const pending = this.fetchLane();
    this.marketRead = { expiresAt: this.now().getTime() + 30_000, pending };
    const lane = await pending;
    if (lane.status !== "available" && this.marketRead?.pending === pending) this.marketRead = null;
    return lane;
  }

  private async fetchLane(symbol?: string): Promise<CandidateDiscoveryLane> {
    try {
      const url = new URL("/stock-screen", this.baseUrl);
      if (symbol) url.searchParams.set("symbol", symbol);
      const response = await this.fetchImpl(url, {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(60_000)
      });
      if (!response.ok) return unavailableCandidateDiscovery(`OpenD candidate screen returned HTTP ${response.status}.`);
      return parseFutuDiscoveryPayload(await response.json(), this.universe, this.now());
    } catch (error) {
      return unavailableCandidateDiscovery(`OpenD candidate screen unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
export class FutuHttpNoticeLeadProvider implements NoticeLeadProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date()
  ) {}

  async read(symbol: string, limit = 10): Promise<NoticeLeadDiscoveryLane> {
    if (!/^HK\.\d{5}$/.test(symbol)) return unavailableNoticeLeads("OpenD information discovery requires one canonical Hong Kong symbol.", symbol);
    try {
      const url = new URL("/notice-leads", this.baseUrl);
      url.searchParams.set("symbol", symbol);
      url.searchParams.set("limit", String(Math.max(1, Math.min(50, Math.floor(limit)))));
      const response = await this.fetchImpl(url, {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(12_000)
      });
      if (!response.ok) return unavailableNoticeLeads(`OpenD information search returned HTTP ${response.status}.`, symbol);
      return parseFutuNoticeLeadPayload(await response.json(), symbol, this.now());
    } catch (error) {
      return unavailableNoticeLeads(`OpenD information search unavailable: ${error instanceof Error ? error.message : String(error)}`, symbol);
    }
  }
}
export class UnavailableNoticeLeadProvider implements NoticeLeadProvider {
  constructor(private readonly reason: string) {}
  async read(symbol: string): Promise<NoticeLeadDiscoveryLane> {
    return unavailableNoticeLeads(this.reason, symbol);
  }
}

export class UnavailableMarketDiscoveryProvider implements MarketDiscoveryProvider {
  constructor(private readonly reason: string) {}
  async read(_symbol?: string): Promise<CandidateDiscoveryLane> {
    return unavailableCandidateDiscovery(this.reason);
  }
}

export class HkexOfficialAnnouncementProvider implements OfficialAnnouncementProvider {
  static readonly searchUrl = "https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=EN";

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date()
  ) {}

  async read(symbol: string, publicationDate?: string): Promise<OfficialAnnouncementDiscoveryLane> {
    if (!/^HK\.\d{5}$/.test(symbol)) return unavailableOfficialAnnouncements("HKEXnews requires one canonical Hong Kong symbol.");
    if (publicationDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(publicationDate)) {
      return unavailableOfficialAnnouncements("HKEXnews publication date is invalid.");
    }
    try {
      const code = symbol.slice(3);
      const stockId = await this.stockId(code);
      const now = this.now();
      const body = hkexSearchBody(stockId, now, publicationDate);
      const response = await this.fetchImpl(HkexOfficialAnnouncementProvider.searchUrl, {
        method: "POST",
        headers: {
          accept: "text/html",
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "investment-assistant-local-alpha/1"
        },
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(12_000)
      });
      if (!response.ok) return unavailableOfficialAnnouncements(`HKEXnews title search returned HTTP ${response.status}.`);
      const html = await response.text();
      if (html.length === 0 || html.length > 2_000_000) return unavailableOfficialAnnouncements("HKEXnews title search response size is invalid.");
      const items = parseHkexOfficialAnnouncements(html, symbol);
      if (items.length === 0 && publicationDate) return {
        status: "available", source: "hkexnews_official",
        sourceUrl: `${HkexOfficialAnnouncementProvider.searchUrl}&market=SEHK&stockId=${stockId}`,
        fetchedAt: now.toISOString(), items: [],
        message: `HKEXnews exact-date search found no issuer PDF metadata on ${publicationDate}; this does not prove that no information exists elsewhere.`
      };
      if (items.length === 0) return unavailableOfficialAnnouncements("HKEXnews returned no current issuer PDF metadata for this symbol.");
      return {
        status: "available",
        source: "hkexnews_official",
        sourceUrl: `${HkexOfficialAnnouncementProvider.searchUrl}&market=SEHK&stockId=${stockId}`,
        fetchedAt: now.toISOString(),
        items,
        message: "HKEXnews issuer PDF metadata; each item remains evidence until the Owner explicitly opens and imports it."
      };
    } catch (error) {
      return unavailableOfficialAnnouncements(`HKEXnews search unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async stockId(code: string): Promise<number> {
    const url = new URL("https://www1.hkexnews.hk/search/prefix.do");
    Object.entries({ callback: "callback", lang: "EN", type: "A", name: code, market: "SEHK" })
      .forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await this.fetchImpl(url, {
      headers: { accept: "application/javascript", "user-agent": "investment-assistant-local-alpha/1" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000)
    });
    const text = await response.text();
    const match = /^callback\((\{[\s\S]*\})\);?\s*$/.exec(text);
    const value: unknown = match ? JSON.parse(match[1]) : null;
    const matches = record(value) && Array.isArray(value.stockInfo)
      ? value.stockInfo.filter((item) => record(item) && item.code === code && Number.isSafeInteger(item.stockId) && Number(item.stockId) > 0)
      : [];
    if (!response.ok || matches.length !== 1) throw new Error("HKEXnews stock identity lookup failed closed.");
    return Number(matches[0].stockId);
  }
}

export function parseFutuNoticeLeadPayload(
  value: unknown,
  expectedSymbol: string,
  receivedAt: Date
): NoticeLeadDiscoveryLane {
  if (!/^HK\.\d{5}$/.test(expectedSymbol) || !Number.isFinite(receivedAt.getTime())
    || !record(value) || value.ok !== true || value.source !== "futu_opend_search_news_information"
    || value.requestedSymbol !== expectedSymbol || value.evidenceStatus !== "unverified_source_lead"
    || typeof value.fetchedAt !== "string" || !Number.isFinite(Date.parse(value.fetchedAt))
    || Date.parse(value.fetchedAt) > receivedAt.getTime()
    || receivedAt.getTime() - Date.parse(value.fetchedAt) > MARKET_DISCOVERY_MAX_AGE_MS
    || !Array.isArray(value.leads) || value.leads.length > 50) {
    return unavailableNoticeLeads("OpenD information search returned an invalid envelope.", expectedSymbol);
  }
  const items = value.leads.flatMap((lead) => {
    if (!record(lead) || !["notice", "major_news"].includes(String(lead.kind))
      || typeof lead.title !== "string" || !between(lead.title, 1, 500)
      || typeof lead.source !== "string" || !between(lead.source, 1, 200)
      || typeof lead.publish_time !== "string" || !Number.isFinite(Date.parse(lead.publish_time))
      || Date.parse(lead.publish_time) > Date.parse(value.fetchedAt as string)
      || !Array.isArray(lead.related_securities)
      || (lead.related_securities.length > 0 && !lead.related_securities.includes(expectedSymbol))
      || lead.related_securities.some((item) => typeof item !== "string" || !/^[A-Z]{2,4}\.[A-Z0-9]{1,20}$/.test(item))
      || new Set(lead.related_securities).size !== lead.related_securities.length
      || typeof lead.url !== "string" || !safeHttpsUrl(lead.url)) return [];
    const identity = {
      kind: lead.kind as "notice" | "major_news",
      symbol: expectedSymbol,
      title: lead.title.trim(),
      source: lead.source.trim(),
      publishedAt: lead.publish_time,
      relatedSecurities: lead.related_securities as string[],
      url: lead.url
    };
    return [{
      id: createHash("sha256").update(JSON.stringify(identity)).digest("hex"),
      ...identity,
      symbol: expectedSymbol,
      evidenceStatus: "unverified_source_lead" as const
    }];
  });
  if (items.length !== value.leads.length
    || new Set(items.map((item) => item.id)).size !== items.length) {
    return unavailableNoticeLeads("OpenD information search returned invalid or mixed-identity leads.", expectedSymbol);
  }
  return {
    status: "available",
    source: "futu_opend_search_news_information",
    requestedSymbol: expectedSymbol,
    fetchedAt: value.fetchedAt,
    items,
    message: "OpenD NOTICE and major-news metadata are unverified source leads only; official evidence still requires an explicit Owner verification or issuer-official HTTPS PDF import."
  };
}

export function exactDiscoveryCandidate(
  lane: CandidateDiscoveryLane,
  request: QualifyMarketDiscoveryCandidateRequest
): MarketDiscoveryCandidate | null {
  if (lane.status !== "available" || lane.source !== "futu_opend_stock_screen_v2" || !lane.fetchedAt || !lane.universe) return null;
  const displayedAt = Date.parse(request.discoveryFetchedAt);
  const currentAt = Date.parse(lane.fetchedAt);
  if (!Number.isFinite(displayedAt) || !Number.isFinite(currentAt)
    || displayedAt > currentAt || currentAt - displayedAt > MARKET_DISCOVERY_MAX_AGE_MS) return null;
  const current = lane.candidates.find((candidate) => candidate.symbol === request.candidate.symbol);
  return current && ["market", "code", "symbol", "name", "industry", "why"].every(
    (key) => current[key as keyof MarketDiscoveryCandidate] === request.candidate[key as keyof MarketDiscoveryCandidate]
  ) ? request.candidate : null;
}

export function candidateDiscoveryFingerprint(candidate: MarketDiscoveryCandidate): string {
  return createHash("sha256").update(JSON.stringify({
    market: candidate.market,
    code: candidate.code,
    symbol: candidate.symbol,
    name: candidate.name,
    industry: candidate.industry,
    price: candidate.price,
    marketCap: candidate.marketCap,
    average20DayTurnover: candidate.average20DayTurnover,
    volumeRatio: candidate.volumeRatio,
    fiveDayChangePercent: candidate.fiveDayChangePercent,
    asOf: candidate.asOf,
    why: candidate.why
  })).digest("hex");
}

export function qualificationBindingIsCurrent(
  envelope: MarketDiscoveryQualificationEnvelope,
  lane: CandidateDiscoveryLane
): boolean {
  if (envelope.status !== "available" || !envelope.binding || lane.status !== "available") return false;
  if (lane.source !== envelope.binding.source || lane.rule.id !== envelope.binding.ruleId
    || lane.fetchedAt !== envelope.binding.discoveryFetchedAt) return false;
  const candidate = lane.candidates.find((item) => item.symbol === envelope.symbol);
  return candidate !== undefined
    && candidate.asOf === envelope.binding.candidateAsOf
    && candidateDiscoveryFingerprint(candidate) === envelope.binding.candidateFingerprint;
}

export function generateMarketDiscoveryQualification(
  lane: CandidateDiscoveryLane,
  candidate: MarketDiscoveryCandidate,
  discoveryFetchedAt = lane.fetchedAt
): MarketDiscoveryQualificationEnvelope {
  if (lane.status !== "available" || lane.source !== "futu_opend_stock_screen_v2" || !discoveryFetchedAt || !lane.universe) {
    throw new Error("candidate discovery is unavailable");
  }
  const facts = qualificationFacts(candidate);
  const unknowns = [
    "当前筛选没有证明业务模式、财务质量或盈利持续性。",
    "当前估值是否合理尚未核实。",
    "5 日价格变化对应的事件或催化剂尚未核实。",
    "中长期技术趋势、失效条件和反证尚未由本次筛选证明。",
    "公司特有风险、行业竞争和监管风险尚未核查。"
  ];
  const nextChecks = [
    "在市场页刷新真实报价与完成交易日日线技术指标。",
    "核对公司官方公告和原始材料，不把标题或价格变化直接当作事实结论。",
    "进入研究页补齐基本面、估值、行业、风险与反证证据。",
    "证据齐备后冻结新证据包，再显式启动完整深度研究。"
  ];
  return {
    schemaVersion: MARKET_DISCOVERY_QUALIFICATION_SCHEMA_VERSION,
    status: "available",
    generatedAt: new Date().toISOString(),
    symbol: candidate.symbol,
    binding: {
      source: lane.source,
      ruleId: lane.rule.id,
      discoveryFetchedAt,
      candidateAsOf: candidate.asOf,
      candidateFingerprint: candidateDiscoveryFingerprint(candidate)
    },
    facts: facts.filter((fact) => fact.key === "screen_match" || fact.key === "five_day_change"),
    unknowns: unknowns.slice(0, 2),
    nextChecks: nextChecks.slice(0, 2),
    reproducibility: {
      generationMethod: "deterministic_frozen_fact_framework",
      provider: "NOT_USED",
      model: "NOT_USED",
      prompt: "NOT_USED",
      tokenUsage: "NOT_USED",
      cost: "NOT_USED"
    },
    message: "服务器只整理当前 OpenD 筛选事实和固定核查项；结果不是推荐，加入研究仍需你明确确认。"
  };
}

export function parseFutuDiscoveryPayload(value: unknown, universe: HkConnectUniverse, receivedAt: Date): CandidateDiscoveryLane {
  const fetchedAt = record(value) && typeof value.fetchedAt === "string" ? Date.parse(value.fetchedAt) : Number.NaN;
  const receivedAtMs = receivedAt.getTime();
  if (!record(value) || value.ok !== true || value.source !== "futu_opend_stock_screen_v2"
    || typeof value.fetchedAt !== "string" || !Number.isFinite(receivedAtMs) || !Number.isFinite(fetchedAt)
    || fetchedAt > receivedAtMs || receivedAtMs - fetchedAt > MARKET_DISCOVERY_MAX_AGE_MS || !record(value.rule)
    || value.rule.id !== "market_attention_v1" || value.rule.notRecommendation !== true
    || typeof value.rule.summary !== "string" || !Number.isSafeInteger(value.totalMatched)
    || Number(value.totalMatched) < 0 || !Array.isArray(value.candidates) || value.candidates.length > 5000) {
    return unavailableCandidateDiscovery("OpenD candidate screen returned an invalid envelope.");
  }
  const decoded = value.candidates.flatMap((candidate) => {
    if (!record(candidate) || candidate.market !== "HK" || typeof candidate.code !== "string"
      || !/^\d{5}$/.test(candidate.code) || candidate.symbol !== `HK.${candidate.code}`
      || typeof candidate.name !== "string" || candidate.name.trim().length === 0
      || !(candidate.industry === null || typeof candidate.industry === "string" && candidate.industry.trim().length > 0)
      || typeof candidate.asOf !== "string" || !Number.isFinite(Date.parse(candidate.asOf))
      || Date.parse(candidate.asOf) > fetchedAt
      || typeof candidate.why !== "string" || candidate.why.trim().length === 0) return [];
    const numeric = [candidate.price, candidate.marketCap, candidate.average20DayTurnover, candidate.volumeRatio, candidate.fiveDayChangePercent];
    if (!numeric.every((item) => typeof item === "number" && Number.isFinite(item))
      || Number(candidate.price) <= 0 || Number(candidate.marketCap) <= 0
      || Number(candidate.average20DayTurnover) < 0 || Number(candidate.volumeRatio) < 0) return [];
    return [{
      market: "HK" as const,
      code: candidate.code,
      symbol: candidate.symbol as string,
      name: candidate.name,
      industry: candidate.industry as string | null,
      price: Number(candidate.price),
      marketCap: Number(candidate.marketCap),
      average20DayTurnover: Number(candidate.average20DayTurnover),
      volumeRatio: Number(candidate.volumeRatio),
      fiveDayChangePercent: Number(candidate.fiveDayChangePercent),
      asOf: candidate.asOf,
      why: `${candidate.why}；属于 ${universe.binding.effectiveDate} 官方港股通股票池（版本 ${universe.binding.snapshotId.slice(0, 12)}）。`
    }];
  });
  if (decoded.length !== value.candidates.length) {
    return unavailableCandidateDiscovery("OpenD candidate screen returned invalid candidate facts.");
  }
  const candidates = decoded.filter((candidate) => universe.members.has(candidate.symbol));
  if (record(value.coverage) && (value.coverage.complete !== true
    || !["market", "selected_symbol"].includes(String(value.coverage.scope))
    || !Number.isSafeInteger(value.coverage.scanned) || Number(value.coverage.scanned) < decoded.length
    || value.coverage.returned !== decoded.length
    || value.coverage.scope === "market" && value.coverage.scanned !== value.totalMatched)) {
    return unavailableCandidateDiscovery("OpenD screening coverage is incomplete or inconsistent.");
  }
  const coverage = record(value.coverage) ? {
    scope: value.coverage.scope as "market" | "selected_symbol", complete: true,
    scanned: Number(value.coverage.scanned), eligibleMatched: candidates.length,
    unavailableSymbols: Array.isArray(value.coverage.unavailableSymbols)
      ? value.coverage.unavailableSymbols.filter((symbol): symbol is string => typeof symbol === "string" && universe.members.has(symbol)) : []
  } : undefined;
  return {
    status: "available",
    source: "futu_opend_stock_screen_v2",
    fetchedAt: value.fetchedAt,
    rule: {
      id: "market_attention_v1",
      summary: value.rule.summary,
      notRecommendation: true
    },
    totalMatched: Number(value.totalMatched),
    ...(coverage ? { coverage } : {}),
    universe: universe.binding,
    candidates,
    message: "OpenD Stock Screening V2 intersected with the exact official Hong Kong Connect snapshot; candidates are attention prompts, not recommendations or rankings."
  };
}

export function parseHkexOfficialAnnouncements(html: string, symbol: string): OfficialAnnouncementDiscoveryItem[] {
  if (!/^HK\.\d{5}$/.test(symbol)) return [];
  const items: OfficialAnnouncementDiscoveryItem[] = [];
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const body = row[1] ?? "";
    const time = /class=["'][^"']*release-time[^"']*["'][^>]*>[\s\S]*?<\/span>\s*(\d{2}\/\d{2}\/\d{4})\s+\d{2}:\d{2}/i.exec(body);
    const code = /class=["'][^"']*stock-short-code[^"']*["'][^>]*>[\s\S]*?<\/span>\s*(\d{5})/i.exec(body)?.[1];
    const link = /class=["']doc-link["'][\s\S]*?<a\s+[^>]*href=["']([^"']+\.pdf)["'][^>]*>([\s\S]*?)<\/a>/i.exec(body);
    if (!time || code !== symbol.slice(3) || !link) continue;
    const [day, month, year] = time[1].split("/");
    const publishedDate = `${year}-${month}-${day}`;
    const documentUrl = new URL(decodeHtml(link[1]), "https://www1.hkexnews.hk").toString();
    const title = decodeHtml(link[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
    if (!Number.isFinite(Date.parse(`${publishedDate}T00:00:00Z`))
      || !/^https:\/\/www1\.hkexnews\.hk\/listedco\/listconews\/sehk\/\d{4}\/\d{4}\/\d+\.pdf$/i.test(documentUrl)
      || title.length === 0 || title.length > 500) continue;
    const classification = classifyAnnouncement(title);
    items.push({
      id: createHash("sha256").update(documentUrl).digest("hex"),
      symbol,
      title,
      publishedDate,
      documentUrl,
      ...classification
    });
    if (items.length === 10) break;
  }
  return items;
}

function hkexSearchBody(stockId: number, now: Date, publicationDate?: string): URLSearchParams {
  const compact = (value: Date) => value.toISOString().slice(0, 10).replace(/-/g, "");
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - 90);
  return new URLSearchParams({
    lang: "EN", category: "0", market: "SEHK", searchType: "0", documentType: "",
    t1code: "", t2Gcode: "", t2code: "", stockId: String(stockId), from: publicationDate?.replaceAll("-", "") ?? compact(from),
    to: publicationDate?.replaceAll("-", "") ?? compact(now), "MB-Daterange": "0"
  });
}

function classifyAnnouncement(title: string): Pick<OfficialAnnouncementDiscoveryItem, "category" | "why"> {
  const normalized = title.toLowerCase();
  if (/next day disclosure return|monthly return/.test(normalized)) {
    return { category: "administrative", why: "常规披露，先核对股本或月度变动，不自动触发投资结论。" };
  }
  if (/annual results|interim results|quarterly results|annual report|interim report|profit warning/.test(normalized)) {
    return { category: "financial_report", why: "标题命中财务报告或业绩预警；需要打开官方 PDF 核验期间、口径与正文。" };
  }
  if (/dividend|share repurchase|buy-back|rights issue|placing|capital raise|share subdivision|share consolidation/.test(normalized)) {
    return { category: "corporate_action", why: "标题命中股息、回购或股本行动；需要打开官方 PDF 核验条件与生效日期。" };
  }
  if (/sales volume|acquisition|disposal|suspension|resumption|connected transaction|medium-term notes|senior notes/.test(normalized)) {
    return { category: "business_change", why: "标题命中经营、融资或交易事项；需要打开官方 PDF 核验正文。" };
  }
  return { category: "other", why: "新的发行人正式披露；需要人工判断是否影响当前研究假设。" };
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, value: string) => String.fromCodePoint(Number.parseInt(value, 16)))
    .replace(/&#(\d+);/g, (_, value: string) => String.fromCodePoint(Number(value)));
}

function between(value: string, minimum: number, maximum: number): boolean {
  return value.trim().length >= minimum && value.length <= maximum;
}

function safeHttpsUrl(value: string): boolean {
  if (value.length === 0 || value.length > 2000) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0 && !url.username && !url.password;
  } catch {
    return false;
  }
}

function qualificationFacts(candidate: MarketDiscoveryCandidate): MarketDiscoveryQualificationFact[] {
  const facts: MarketDiscoveryQualificationFact[] = [
    { key: "screen_match", label: "筛选命中", value: candidate.why, meaning: "只说明满足透明观察规则，不证明投资价值。" },
    { key: "price", label: "现价", value: `${candidate.price} HKD`, meaning: `数据截止 ${candidate.asOf}。` },
    { key: "market_cap", label: "市值", value: `${candidate.marketCap} HKD`, meaning: "用于确认筛选规模条件。" },
    { key: "turnover", label: "20 日平均成交额", value: `${candidate.average20DayTurnover} HKD`, meaning: "用于确认低频研究的基础流动性。" },
    { key: "volume_ratio", label: "量比", value: String(candidate.volumeRatio), meaning: "只反映当前成交活跃度变化。" },
    { key: "five_day_change", label: "5 日涨跌幅", value: `${candidate.fiveDayChangePercent}%`, meaning: "价格变化用于发现，不代表方向或预期收益。" }
  ];
  if (candidate.industry) facts.push({ key: "industry", label: "行业", value: candidate.industry, meaning: "来自当前 OpenD 候选快照。" });
  return facts;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
