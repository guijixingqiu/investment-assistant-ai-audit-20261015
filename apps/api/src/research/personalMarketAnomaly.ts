import { readAnomalyReceipt, recordAnomalyReceipt } from "./personalMarketAnomalyJournal.js";
import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import type { Pool } from "pg";
import { readCandidateMembershipById } from "./candidateMembershipPersistence.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import type { MarketEnvironmentProvider } from "../market/environmentProvider.js";
import { marketEnvironmentFreshness } from "../../../../packages/contracts/src/marketEnvironment.js";
import type { NoticeLeadProvider, OfficialAnnouncementProvider } from "../market/discovery.js";
import { buildPersonalResearchBrief } from "../routes/personalResearchRoutes.js";
import { readResearchReview } from "./researchReviewRepository.js";
import type { ResearchDocumentRuntimeOptions } from "../routes/researchDocumentRoutes.js";

export const ANOMALY_RULE_VERSION = "personal-market-anomaly-v1";
const CAPTURE_MAX_LAG_MS = 5 * 60_000;
const DISCOVERY_CACHE_MS = 10 * 60_000;
const discoveryCache = new Map<string, { expiresAt: number; value: SourceDiscovery }>();
const benchmarkCache = new Map<string, { observedAt: number; value: NonNullable<MarketAnomaly["benchmark"]> }>();

export type MarketAnomaly = {
  id: string; fingerprint: string; ruleVersion: typeof ANOMALY_RULE_VERSION;
  symbol: string; membershipId: string; membershipVersion: number; tradingDate: string;
  direction: "down" | "up"; thresholdBand: "five_to_eight" | "eight_plus";
  quote: { price: number; previousClose: number; changePercent: number; quoteTime: string; fetchedAt: string };
  benchmark: { symbol: "HK.800000"; changePercent: number; asOf: string } | null;
  relativeChangePoints: number | null; relativeContext: "confirmed" | "unknown";
  freshness: "fresh" | "stored_day_observation";
  observation?: { firstDetectedAt: string; latestObservedAt: string; highestSeverity: "five_to_eight" | "eight_plus" };
  investigationState: "INVESTIGATION_REQUIRED";
};
export type InvestigationFact = { text: string; sourceIds: string[] };
export type SourceDiscovery = {
  hkex: { status: "searched" | "unavailable"; checkedDate: string; fetchedAt: string | null;
    items: Array<{ id: string; title: string; publishedDate: string; documentUrl: string }> };
  news: { status: "available" | "NEWS_DISCOVERY_UNAVAILABLE"; fetchedAt: string | null;
    leads: Array<{ id: string; citationId: string; symbol: string; title: string; publisher: string; publishedAt: string; url: string; kind: string; evidenceStatus: "LEAD" }> };
};
export type LightInvestigation = {
  anomaly: MarketAnomaly; fingerprint: string;
  confirmedFacts: InvestigationFact[]; possibleExplanations: InvestigationFact[];
  unknowns: string[]; researchImpact: "PRICE_ONLY_NO_FORMAL_IMPACT_EVIDENCE" | "POTENTIAL_OPERATING_EVIDENCE_REQUIRES_REVIEW" | "OFFICIAL_MATERIAL_MAY_AFFECT_EXISTING_RESEARCH";
  nextChecks: string[]; sourceCoverage: string; discovery: SourceDiscovery;
  dailyHistory?: { status: "available" | "unavailable"; snapshotSha: string | null;
    latestSession: string | null; latestClose: number | null; previousSession: string | null;
    previousClose: number | null; quotePreviousCloseMatches: boolean | null;
    volumeAssessment: "UNKNOWN_NO_SAME_TIME_BASELINE" };
  formalResearch: { status: string; thesisLineageId: string | null; baselineId: string | null;
    currentBaseId: string | null; summary: string } | null;
  publicResearch: { briefFingerprint: string | null; latestFinancialDocument: {
    id: string; title: string; pdfSha256: string; sourceUrl: string | null; publishedAt: string
  } | null; sources: Array<{ id: string; title: string; pageNumber: number; pageTextSha256: string; excerpt: string }> };
};

export type TodayMarketAnomalyScreening = {
  binding: { membershipId: string; membershipVersion: number; symbol: string } | null;
  anomaly: MarketAnomaly | null;
  benchmarkGap: { quoteTime: string; tradingDate: string; changePercent: number } | null;
  quoteProblem: boolean;
};

type QuoteRow = { symbol: string; price: string; previous_close: string | null;
  change_percent: string | null; quote_time: Date | string; fetched_at: Date | string; provider: string; provider_status: string };
type Membership = NonNullable<Awaited<ReturnType<typeof readCandidateMembershipById>>>;
export type MarketAnomalyOptions = {
  pool: Pool; quoteLiveMaxAgeSeconds: number; marketEnvironmentProvider?: MarketEnvironmentProvider;
  benchmarkCacheFile?: string; anomalyJournalFile?: string;
  announcementProvider?: OfficialAnnouncementProvider; noticeLeadProvider?: NoticeLeadProvider;
  researchDocument?: ResearchDocumentRuntimeOptions; now?: () => Date;
};

export function hongKongTradingDate(value: Date | string): string {
  return new Date(new Date(value).getTime() + 8 * 60 * 60_000).toISOString().slice(0, 10);
}

function validQuoteObservation(quote: QuoteRow, symbol: string, now: Date): {
  quoteTime: number; fetchedAt: number; price: number; previousClose: number; changePercent: number
} | null {
  const quoteTime = new Date(quote.quote_time).getTime(), fetchedAt = new Date(quote.fetched_at).getTime();
  const price = Number(quote.price), previousClose = Number(quote.previous_close), changePercent = Number(quote.change_percent);
  if (quote.symbol !== symbol || quote.provider !== "futu" || quote.provider_status !== "live"
    || !Number.isFinite(quoteTime) || !Number.isFinite(fetchedAt) || quoteTime > fetchedAt
    || fetchedAt > now.getTime() || fetchedAt - quoteTime > CAPTURE_MAX_LAG_MS
    || !Number.isFinite(price) || price <= 0 || !Number.isFinite(previousClose) || previousClose <= 0
    || !Number.isFinite(changePercent) || Math.abs(changePercent - (price / previousClose - 1) * 100) > 0.05
    || hongKongTradingDate(quote.quote_time) !== hongKongTradingDate(now)) return null;
  return { quoteTime, fetchedAt, price, previousClose, changePercent };
}

function currentBenchmark(benchmark: MarketAnomaly["benchmark"], quoteTime: number, date: string): MarketAnomaly["benchmark"] {
  return benchmark && benchmark.symbol === "HK.800000"
    && Number.isFinite(benchmark.changePercent) && hongKongTradingDate(benchmark.asOf) === date
    && Math.abs(new Date(benchmark.asOf).getTime() - quoteTime) <= 30 * 60_000 ? benchmark : null;
}

export function detectMarketAnomaly(input: {
  membershipId: string; membershipVersion: number; symbol: string; quote: QuoteRow;
  benchmark: { symbol: "HK.800000"; changePercent: number; asOf: string } | null;
  now: Date; liveMaxAgeSeconds: number
}): MarketAnomaly | null {
  const { quote, benchmark, now } = input;
  const observed = validQuoteObservation(quote, input.symbol, now);
  if (!observed || Math.abs(observed.changePercent) < 5) return null;
  const { quoteTime, fetchedAt, price, previousClose, changePercent } = observed;
  const date = hongKongTradingDate(quote.quote_time);
  const benchmarkCurrent = currentBenchmark(benchmark, quoteTime, date);
  const relativeChangePoints = benchmarkCurrent ? changePercent - benchmarkCurrent.changePercent : null;
  if (benchmarkCurrent ? Math.abs(relativeChangePoints!) < 3 : Math.abs(changePercent) < 8) return null;
  const direction = changePercent < 0 ? "down" : "up";
  const thresholdBand = Math.abs(changePercent) >= 8 ? "eight_plus" : "five_to_eight";
  const id = `market-anomaly:${input.membershipId}:v${input.membershipVersion}:${date}:${direction}:${thresholdBand}:${ANOMALY_RULE_VERSION}`;
  const fingerprint = createHash("sha256").update(JSON.stringify({
    id, quote: [quoteTime, fetchedAt, price, previousClose, changePercent],
    benchmark: benchmarkCurrent ? [benchmarkCurrent.symbol, benchmarkCurrent.asOf, benchmarkCurrent.changePercent] : null
  })).digest("hex");
  const fresh = now.getTime() - quoteTime <= input.liveMaxAgeSeconds * 1000;
  return { id, fingerprint, ruleVersion: ANOMALY_RULE_VERSION, symbol: input.symbol,
    membershipId: input.membershipId, membershipVersion: input.membershipVersion, tradingDate: date,
    direction, thresholdBand, quote: { price, previousClose, changePercent,
      quoteTime: new Date(quoteTime).toISOString(), fetchedAt: new Date(fetchedAt).toISOString() },
    benchmark: benchmarkCurrent, relativeChangePoints,
    relativeContext: benchmarkCurrent ? "confirmed" : "unknown",
    freshness: fresh ? "fresh" : "stored_day_observation", investigationState: "INVESTIGATION_REQUIRED" };
}

export async function readMarketAnomaly(options: MarketAnomalyOptions, membershipId: string,
  actor: AuthenticatedResearchActor, now = options.now?.() ?? new Date(), eventDate?: string): Promise<MarketAnomaly | null> {
  const membership = await readCandidateMembershipById(options.pool, actor, membershipId);
  if (!membership || membership.state !== "tracked" || !/^HK\.\d{5}$/.test(membership.symbol)) return null;
  if (options.anomalyJournalFile) {
    const stored = await readAnomalyReceipt(options.anomalyJournalFile, actor,
      { id: membership.id, version: Number(membership.version), symbol: membership.symbol }, now, options.quoteLiveMaxAgeSeconds, eventDate);
    if (stored) return stored;
  }
  if (eventDate && eventDate !== hongKongTradingDate(now)) return null;
  return readForMembership(options, membership, now);
}

/** Today intentionally reads stored evidence only; an unresolved 5–8% move is exposed as a gap. */
export async function readTodayMarketAnomalyScreening(options: MarketAnomalyOptions, membershipId: string,
  actor: AuthenticatedResearchActor, now = options.now?.() ?? new Date()): Promise<TodayMarketAnomalyScreening> {
  const none: TodayMarketAnomalyScreening = { binding: null, anomaly: null, benchmarkGap: null, quoteProblem: false };
  const membership = await readCandidateMembershipById(options.pool, actor, membershipId);
  if (!membership || membership.state !== "tracked" || !/^HK\.\d{5}$/.test(membership.symbol)) return none;
  const bound = { ...none, binding: { membershipId: membership.id,
    membershipVersion: Number(membership.version), symbol: membership.symbol } };
  if (options.anomalyJournalFile) {
    const stored = await readAnomalyReceipt(options.anomalyJournalFile, actor,
      { id: membership.id, version: Number(membership.version), symbol: membership.symbol }, now, options.quoteLiveMaxAgeSeconds);
    if (stored) return { ...bound, anomaly: stored };
  }
  const quote = await readQuoteForMembership(options, membership, now);
  if (!quote) return bound;
  const observed = validQuoteObservation(quote, membership.symbol, now);
  if (!observed) return { ...bound, quoteProblem: true };
  const benchmark = await readSavedBenchmark(options, now);
  const anomaly = detectMarketAnomaly({ membershipId: membership.id, membershipVersion: Number(membership.version),
    symbol: membership.symbol, quote, benchmark, now, liveMaxAgeSeconds: options.quoteLiveMaxAgeSeconds });
  const benchmarkGap = !anomaly && Math.abs(observed.changePercent) >= 5 && Math.abs(observed.changePercent) < 8
    && !currentBenchmark(benchmark, observed.quoteTime, hongKongTradingDate(quote.quote_time))
    ? { quoteTime: new Date(observed.quoteTime).toISOString(), tradingDate: hongKongTradingDate(quote.quote_time),
      changePercent: observed.changePercent } : null;
  return { ...bound, anomaly, benchmarkGap, quoteProblem: false };
}

export async function readMarketAnomalies(options: MarketAnomalyOptions, actor: AuthenticatedResearchActor,
  now = options.now?.() ?? new Date()): Promise<MarketAnomaly[]> {
  const rows = await options.pool.query<{ id: string }>(`select id::text from candidate_memberships
    where actor_type=$1 and actor_id=$2 and state='tracked' and symbol ~ '^HK\\.[0-9]{5}$'
    order by id limit 25`, [actor.actorType, actor.actorId]);
  const results = await Promise.all(rows.rows.map((row) => readMarketAnomaly(options, row.id, actor, now)));
  return results.filter((item): item is MarketAnomaly => item !== null);
}

export async function observeMarketAnomaly(options: MarketAnomalyOptions, membershipId: string,
  actor: AuthenticatedResearchActor, now = options.now?.() ?? new Date()): Promise<MarketAnomaly | null> {
  if (!options.anomalyJournalFile) throw new Error("ANOMALY_JOURNAL_NOT_CONFIGURED");
  const membership = await readCandidateMembershipById(options.pool, actor, membershipId);
  if (!membership || membership.state !== "tracked" || !/^HK\.\d{5}$/.test(membership.symbol)) return null;
  const event = await readForMembership(options, membership, now, true);
  if (event) await recordAnomalyReceipt(options.anomalyJournalFile, actor, event, now);
  // Re-read membership so archive/version drift cannot return a recorded stale identity.
  return readMarketAnomaly(options, membershipId, actor, now);
}

async function readForMembership(options: MarketAnomalyOptions, membership: Membership, now: Date, persistBenchmark = false): Promise<MarketAnomaly | null> {
  const quote = await readQuoteForMembership(options, membership, now);
  if (!quote) return null;
  let benchmark: MarketAnomaly["benchmark"] = null;
  try {
    const environment = await options.marketEnvironmentProvider?.getEnvironment("HK", membership.code);
    if (environment?.status === "available" && environment.data
      && marketEnvironmentFreshness(environment, now) !== "stale") {
      const hsi = environment.data.indices.find((item) => item.symbol === "HK.800000");
      if (hsi) {
        benchmark = { symbol: "HK.800000", changePercent: hsi.changePercent, asOf: hsi.asOf };
        benchmarkCache.set(hongKongTradingDate(now), { observedAt: now.getTime(), value: benchmark });
        if (persistBenchmark && options.benchmarkCacheFile) await storeBenchmarkObservation(options.benchmarkCacheFile,
          hongKongTradingDate(now), now, benchmark).catch(() => undefined);
      }
    }
  } catch { /* Benchmark is optional; absolute rule remains explicit. */ }
  if (!benchmark) benchmark = await readSavedBenchmark(options, now);
  return detectMarketAnomaly({ membershipId: membership.id, membershipVersion: Number(membership.version),
    symbol: membership.symbol, quote, benchmark, now, liveMaxAgeSeconds: options.quoteLiveMaxAgeSeconds });
}

async function readQuoteForMembership(options: MarketAnomalyOptions, membership: Membership, now: Date): Promise<QuoteRow | null> {
  const rows = await options.pool.query<QuoteRow>(`select symbol,price::text,previous_close::text,change_percent::text,
    quote_time,fetched_at,provider,provider_status from market_quotes
    where market='HK' and code=$1 and symbol=$2 and quote_time >= $3::date - interval '8 hours'
      and quote_time < $3::date + interval '16 hours'
    order by quote_time desc,fetched_at desc limit 1`, [membership.code, membership.symbol, hongKongTradingDate(now)]);
  const quote = rows.rows[0];
  return quote ?? null;
}

async function readSavedBenchmark(options: MarketAnomalyOptions, now: Date): Promise<MarketAnomaly["benchmark"]> {
  const date = hongKongTradingDate(now), cached = benchmarkCache.get(date);
  const localHour = new Date(now.getTime() + 8 * 60 * 60_000).getUTCHours();
  if (cached && (now.getTime() - cached.observedAt <= 10 * 60_000 || localHour >= 16)) return cached.value;
  return options.benchmarkCacheFile
    ? readBenchmarkObservation(options.benchmarkCacheFile, date, now, localHour).catch(() => null) : null;
}

async function storeBenchmarkObservation(path: string, date: string, now: Date,
  value: NonNullable<MarketAnomaly["benchmark"]>): Promise<void> {
  if (value.symbol !== "HK.800000" || !Number.isFinite(value.changePercent)
    || hongKongTradingDate(value.asOf) !== date) return;
  const temporary = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.part`;
  await writeFile(temporary, JSON.stringify({ version: 1, date, observedAt: now.toISOString(), value }), { mode: 0o600 });
  await rename(temporary, path);
}

async function readBenchmarkObservation(path: string, date: string, now: Date,
  localHour: number): Promise<MarketAnomaly["benchmark"]> {
  const data: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>, value = row.value as Record<string, unknown> | null;
  const observedAt = typeof row.observedAt === "string" ? Date.parse(row.observedAt) : NaN;
  if (row.version !== 1 || row.date !== date || !Number.isFinite(observedAt) || observedAt > now.getTime()
    || localHour < 16 && now.getTime() - observedAt > 10 * 60_000
    || !value || value.symbol !== "HK.800000" || typeof value.asOf !== "string"
    || !Number.isFinite(value.changePercent) || hongKongTradingDate(value.asOf) !== date) return null;
  return { symbol: "HK.800000", changePercent: value.changePercent as number, asOf: value.asOf };
}

export async function buildLightInvestigation(options: MarketAnomalyOptions, membershipId: string,
  actor: AuthenticatedResearchActor, now = options.now?.() ?? new Date(), forceDiscovery = false, eventDate?: string): Promise<LightInvestigation | null> {
  const anomaly = await readMarketAnomaly(options, membershipId, actor, now, eventDate);
  if (!anomaly) return null;
  const discovery = await discoverSources(options, anomaly, now, forceDiscovery);
  const brief = await buildPersonalResearchBrief(options.pool, membershipId, actor, {
    researchDocument: options.researchDocument, now: () => now
  }).catch(() => null);
  if (brief && (brief.symbol !== anomaly.symbol || brief.membershipVersion !== anomaly.membershipVersion)) return null;
  const sourceStore=options.researchDocument?{repositoryRoot:options.researchDocument.repositoryRoot,
    rawStoreRoot:options.researchDocument.rawStoreRoot,availabilityCache:new Map()}:undefined;
  const formal = await readResearchReview(options.pool, membershipId, actor, now,"CURRENT_FY",false,sourceStore).catch(() => null);
  if (formal && (formal.symbol !== anomaly.symbol || formal.membershipVersion !== anomaly.membershipVersion)) return null;
  const formalResearch = formal ? { status: formal.status,
    thesisLineageId: formal.activeMilestone?.thesisLineageId ?? null,
    baselineId: formal.underwriting?.baseline?.baselineId ?? null,
    currentBaseId: formal.underwriting?.currentBase?.scenarioId ?? null,
    summary: formal.underwriting?.currentBase
      ? "已有人工确认的研究 Base；价格异常自身不足以改变其经营假设" : "当前没有可引用的正式 Base" } : null;
  const light = assembleLightInvestigation(anomaly, discovery, brief, formalResearch);
  return { ...light, dailyHistory: await readDailyHistory(options.pool, anomaly) };
}

export async function readDailyHistory(pool: Pool, anomaly: MarketAnomaly): Promise<NonNullable<LightInvestigation["dailyHistory"]>> {
  const unavailable: NonNullable<LightInvestigation["dailyHistory"]> = { status: "unavailable", snapshotSha: null,
    latestSession: null, latestClose: null, previousSession: null, previousClose: null,
    quotePreviousCloseMatches: null, volumeAssessment: "UNKNOWN_NO_SAME_TIME_BASELINE" };
  try {
    const snapshot = await pool.query<{ snapshot_sha: string }>(`select snapshot_sha from market_daily_snapshots
      where symbol=$1 and completed_sessions_only=true and rights_status='confirmed'
        and retention_status='confirmed' and derived_use_status='confirmed'
        and last_session <= $2::date
      order by last_session desc,created_at desc limit 1`, [anomaly.symbol, anomaly.tradingDate]);
    const sha = snapshot.rows[0]?.snapshot_sha;
    if (!sha || !/^[a-f0-9]{64}$/.test(sha)) return unavailable;
    const bars = await pool.query<{ session: Date | string; close: string }>(`select session,close::text from market_daily_bars
      where snapshot_sha=$1 order by session desc limit 2`, [sha]);
    if (bars.rows.length < 2) return unavailable;
    const [latest, previous] = bars.rows;
    const latestSession = hongKongTradingDate(latest.session);
    const previousSession = hongKongTradingDate(previous.session);
    const latestClose = Number(latest.close), previousClose = Number(previous.close);
    if (latestSession > anomaly.tradingDate) return { ...unavailable, quotePreviousCloseMatches: false };
    if (previousSession >= latestSession
      || !Number.isFinite(latestClose) || latestClose <= 0 || !Number.isFinite(previousClose) || previousClose <= 0) return unavailable;
    return { status: "available", snapshotSha: sha, latestSession, latestClose, previousSession,
      previousClose, quotePreviousCloseMatches: Math.abs((latestSession === anomaly.tradingDate ? previousClose : latestClose)
        - anomaly.quote.previousClose) <= 0.01,
      volumeAssessment: "UNKNOWN_NO_SAME_TIME_BASELINE" };
  } catch { return unavailable; }
}

export function assembleLightInvestigation(anomaly: MarketAnomaly, discovery: SourceDiscovery,
  brief: Awaited<ReturnType<typeof buildPersonalResearchBrief>>,
  formalResearch: LightInvestigation["formalResearch"] = null): LightInvestigation {
  discovery = { ...discovery, news: { ...discovery.news,
    leads: discovery.news.leads.filter((lead) => lead.symbol === anomaly.symbol
      && hongKongTradingDate(lead.publishedAt) === anomaly.tradingDate) } };
  const confirmedFacts: InvestigationFact[] = [
    { text: `${anomaly.symbol} ${anomaly.tradingDate} 价格变化 ${anomaly.quote.changePercent.toFixed(2)}%，报价时间 ${anomaly.quote.quoteTime}。`, sourceIds: ["Q"] }
  ];
  if (anomaly.benchmark) confirmedFacts.push({ text: `恒生指数同期变化 ${anomaly.benchmark.changePercent.toFixed(2)}%；该股票相对变化 ${anomaly.relativeChangePoints!.toFixed(2)} 个百分点。`, sourceIds: ["Q", "B"] });
  if (discovery.hkex.status === "searched") confirmedFacts.push({
    text: discovery.hkex.items.length
      ? `HKEX 精确日期检索找到 ${discovery.hkex.items.length} 条发行人公告元数据；须逐条核对正文。`
      : "HKEX 精确日期检索暂未发现当日发行人 PDF 公告元数据；不等于所有渠道绝无新消息。",
    sourceIds: discovery.hkex.items.map((item) => item.id).slice(0, 3).concat("HKEX_SEARCH")
  });
  const possibleExplanations: InvestigationFact[] = [];
  if (anomaly.benchmark) possibleExplanations.push({ text: "市场共同波动可能贡献部分价格变化，但不能单独证明公司特异性根因。", sourceIds: ["B"] });
  if (discovery.news.leads.length) possibleExplanations.push({
    text: "Futu 新闻标题提供待核验线索；标题不是事实，也不能直接当作下跌原因。",
    sourceIds: discovery.news.leads.slice(0, 3).map((lead) => lead.citationId)
  });
  const unknowns = ["ROOT_CAUSE_UNCONFIRMED", "价格变化对销量、均价、利润及当前 Thesis 的影响尚无足够新证据。"];
  const researchImpact = discovery.hkex.items.some((item) => /profit warning|盈利预警|业绩预警/i.test(item.title))
    ? "OFFICIAL_MATERIAL_MAY_AFFECT_EXISTING_RESEARCH"
    : discovery.hkex.items.some((item) => /sales volume|销量|经营数据|operating data/i.test(item.title))
      ? "POTENTIAL_OPERATING_EVIDENCE_REQUIRES_REVIEW" : "PRICE_ONLY_NO_FORMAL_IMPACT_EVIDENCE";
  const nextChecks = ["核对当日或收市后 HKEX 与发行人公告原文。", "核验新闻线索原文及上市公司主体。", "检查成交量、同行走势与公司回应；保持根因 UNKNOWN 直至有新证据。"];
  const sourceCoverage = `官方公告：${discovery.hkex.status}；公司资料：${brief?.latestFinancialDocument ? "current library" : "unavailable"}；Futu Search News：${discovery.news.status}；当前研究库：${brief?.status ?? "unavailable"}；正式研究只读摘要：${formalResearch?.summary ?? "unavailable"}。未执行全网搜索。`;
  const publicResearch = { briefFingerprint: brief?.fingerprint ?? null, latestFinancialDocument: brief?.latestFinancialDocument ?? null,
    sources: brief?.sources.map(({ id, title, pageNumber, pageTextSha256, excerpt }) =>
      ({ id, title, pageNumber, pageTextSha256, excerpt })) ?? [] };
  const fingerprint = createHash("sha256").update(JSON.stringify({
    anomaly: anomaly.fingerprint,
    hkex: { status: discovery.hkex.status, checkedDate: discovery.hkex.checkedDate, items: discovery.hkex.items },
    news: { status: discovery.news.status, leads: discovery.news.leads },
    brief: brief?.fingerprint ?? null, formalResearch, sourceCoverage
  })).digest("hex");
  return { anomaly, fingerprint, confirmedFacts, possibleExplanations, unknowns, researchImpact,
    nextChecks, sourceCoverage, discovery, publicResearch, formalResearch };
}

async function discoverSources(options: MarketAnomalyOptions, anomaly: MarketAnomaly, now: Date, force = false): Promise<SourceDiscovery> {
  const key = `${anomaly.symbol}:${anomaly.tradingDate}`;
  const cached = discoveryCache.get(key);
  if (!force && cached && cached.expiresAt > now.getTime()) return cached.value;
  const [officialResult, newsResult] = await Promise.allSettled([
    options.announcementProvider?.read(anomaly.symbol, anomaly.tradingDate),
    options.noticeLeadProvider?.read(anomaly.symbol)
  ]);
  const official = officialResult.status === "fulfilled" ? officialResult.value : null;
  const news = newsResult.status === "fulfilled" ? newsResult.value : null;
  const hkex: SourceDiscovery["hkex"] = {
    status: official?.status === "available" ? "searched" : "unavailable",
    checkedDate: anomaly.tradingDate, fetchedAt: official?.fetchedAt ?? null,
    items: official?.status === "available"
      ? official.items.filter((item) => item.publishedDate === anomaly.tradingDate)
        .slice(0, 10).map((item) => ({ id: item.id, title: item.title,
          publishedDate: item.publishedDate, documentUrl: item.documentUrl })) : []
  };
  const leads = news?.status === "available" ? news.items.filter((item) => item.symbol === anomaly.symbol
    && hongKongTradingDate(item.publishedAt) === anomaly.tradingDate
    && (item.relatedSecurities.length === 0 || item.relatedSecurities.includes(anomaly.symbol)))
    .slice(0, 10).map((item, index) => ({ id: item.id, citationId: `N${index + 1}`, symbol: item.symbol, title: item.title, publisher: item.source,
      publishedAt: item.publishedAt, url: item.url, kind: item.kind, evidenceStatus: "LEAD" as const })) : [];
  const value: SourceDiscovery = { hkex, news: {
    status: news?.status === "available" ? "available" : "NEWS_DISCOVERY_UNAVAILABLE",
    fetchedAt: news?.fetchedAt ?? null, leads
  } };
  discoveryCache.set(key, { expiresAt: now.getTime() + DISCOVERY_CACHE_MS, value });
  return value;
}
