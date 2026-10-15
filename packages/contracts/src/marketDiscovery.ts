import { isRfc3339DateTime } from "./factMetadata.js";

export const MARKET_DISCOVERY_SCHEMA_VERSION = "2026-08-20.hk-connect-daily-discovery.v7";
export const MARKET_DISCOVERY_QUALIFICATION_SCHEMA_VERSION = "2026-08-06.market-discovery-qualification.v1";
export const MARKET_DISCOVERY_MAX_AGE_MS = 5 * 60 * 1_000;

export type DiscoveryLaneStatus = "available" | "unavailable";

export interface MarketDiscoveryCandidate {
  market: "HK";
  code: string;
  symbol: string;
  name: string;
  industry: string | null;
  price: number;
  marketCap: number;
  average20DayTurnover: number;
  volumeRatio: number;
  fiveDayChangePercent: number;
  asOf: string;
  why: string;
}

export interface CandidateDiscoveryLane {
  status: DiscoveryLaneStatus;
  source: "futu_opend_stock_screen_v2" | "unavailable";
  fetchedAt: string | null;
  rule: {
    id: "market_attention_v1";
    summary: string;
    notRecommendation: true;
  };
  totalMatched: number | null;
  coverage?: { scope: "market" | "selected_symbol"; complete: boolean; scanned: number; eligibleMatched: number; unavailableSymbols?: string[] };
  universe: CandidateDiscoveryUniverse | null;
  candidates: MarketDiscoveryCandidate[];
  message: string;
}
export interface CandidateDiscoveryUniverse {
  source: "hkex_sse_szse_southbound_official";
  snapshotId: string;
  effectiveDate: string;
  capturedAt: string;
  memberCount: number;
  sourceUrls: [string, string];
}
export interface MarketDiscoveryEligibility { requestedSymbol: string; status: "eligible" | "not_eligible" | "unknown"; universe: CandidateDiscoveryUniverse | null; message: string; }
export type OfficialAnnouncementCategory = "financial_report" | "corporate_action" | "business_change" | "administrative" | "other";

export interface OfficialAnnouncementDiscoveryItem {
  id: string;
  symbol: string;
  title: string;
  publishedDate: string;
  documentUrl: string;
  category: OfficialAnnouncementCategory;
  why: string;
}

export interface OfficialAnnouncementDiscoveryLane {
  status: DiscoveryLaneStatus;
  source: "hkexnews_official" | "unavailable";
  sourceUrl: string;
  fetchedAt: string | null;
  items: OfficialAnnouncementDiscoveryItem[];
  message: string;
}

export interface NoticeLeadDiscoveryItem {
  id: string;
  kind: "notice" | "major_news";
  symbol: string;
  title: string;
  source: string;
  publishedAt: string;
  relatedSecurities: string[];
  url: string;
  evidenceStatus: "unverified_source_lead";
}

export interface NoticeLeadDiscoveryLane {
  status: DiscoveryLaneStatus;
  source: "futu_opend_search_news_information" | "unavailable";
  requestedSymbol: string;
  fetchedAt: string | null;
  items: NoticeLeadDiscoveryItem[];
  message: string;
}

export interface MarketDiscoveryEnvelope {
  schemaVersion: typeof MARKET_DISCOVERY_SCHEMA_VERSION;
  status: "available" | "partial" | "unavailable";
  generatedAt: string;
  eligibility: MarketDiscoveryEligibility;
  candidates: CandidateDiscoveryLane;
  notices: NoticeLeadDiscoveryLane;
  announcements: OfficialAnnouncementDiscoveryLane;
  message: string;
}

export interface QualifyMarketDiscoveryCandidateRequest {
  candidate: MarketDiscoveryCandidate;
  discoveryFetchedAt: string;
}

export interface MarketDiscoveryQualificationFact {
  key: "screen_match" | "price" | "market_cap" | "turnover" | "volume_ratio" | "five_day_change" | "industry";
  label: string;
  value: string;
  meaning: string;
}

export interface MarketDiscoveryQualificationEnvelope {
  schemaVersion: typeof MARKET_DISCOVERY_QUALIFICATION_SCHEMA_VERSION;
  status: "available" | "conflict" | "unavailable";
  generatedAt: string;
  symbol: string;
  binding: {
    source: "futu_opend_stock_screen_v2";
    ruleId: "market_attention_v1";
    discoveryFetchedAt: string;
    candidateAsOf: string;
    candidateFingerprint: string;
  } | null;
  facts: MarketDiscoveryQualificationFact[];
  unknowns: string[];
  nextChecks: string[];
  reproducibility: {
    generationMethod: "deepseek_selected_grounded_discovery_facts" | "deterministic_frozen_fact_framework" | "NOT_USED";
    provider: "deepseek" | "NOT_USED";
    model: "deepseek-v4-flash" | "deepseek-flash" | "NOT_USED";
    prompt: "market-discovery-qualification.v1" | "NOT_USED";
    tokenUsage: string;
    cost: "UNKNOWN" | "NOT_USED";
  };
  message: string;
}

export function validateMarketDiscoveryEnvelope(
  value: unknown,
  expectedNoticeSymbol = "HK.00175",
  now = new Date()
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return { ok: false, errors: ["envelope must be an object"] };
  if (value.schemaVersion !== MARKET_DISCOVERY_SCHEMA_VERSION) errors.push("schemaVersion is invalid");
  if (!["available", "partial", "unavailable"].includes(String(value.status))) errors.push("status is invalid");
  instant(value.generatedAt, "generatedAt", errors);
  const generatedAt = typeof value.generatedAt === "string" ? Date.parse(value.generatedAt) : Number.NaN;
  const age = now.getTime() - generatedAt;
  if (!Number.isFinite(age) || age < 0 || age > MARKET_DISCOVERY_MAX_AGE_MS) errors.push("generatedAt is stale or in the future");
  validateMarketDiscoveryEligibility(value.eligibility, expectedNoticeSymbol, errors);
  validateCandidateLane(value.candidates, value.generatedAt, errors);
  if (record(value.candidates) && value.candidates.status === "available"
    && !sameCandidateDiscoveryUniverse(record(value.eligibility) ? value.eligibility.universe : null, value.candidates.universe)) {
    errors.push("eligibility and candidates must bind the same universe");
  }
  validateNoticeLane(value.notices, value.generatedAt, expectedNoticeSymbol, errors);
  validateAnnouncementLane(value.announcements, expectedNoticeSymbol, errors);
  if (typeof value.message !== "string" || value.message.trim().length === 0) errors.push("message is required");
  if (record(value.candidates) && record(value.notices) && record(value.announcements)) {
    const availableCount = [value.candidates.status, value.notices.status, value.announcements.status]
      .filter((status) => status === "available").length;
    const expected = availableCount === 3 ? "available" : availableCount > 0 ? "partial" : "unavailable";
    if (value.status !== expected) errors.push("status must summarize the three discovery lanes");
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function unknownMarketDiscoveryEligibility(requestedSymbol: string, message: string): MarketDiscoveryEligibility { return { requestedSymbol, status: "unknown", universe: null, message }; }
export function unavailableCandidateDiscovery(message: string): CandidateDiscoveryLane {
  return {
    status: "unavailable",
    source: "unavailable",
    fetchedAt: null,
    rule: {
      id: "market_attention_v1",
      summary: "港股价格≥1港元、市值≥50亿港元、20日平均成交额≥2000万港元；按5日涨跌幅绝对值观察。",
      notRecommendation: true
    },
    totalMatched: null,
    universe: null,
    candidates: [],
    message
  };
}

export function unavailableOfficialAnnouncements(message: string): OfficialAnnouncementDiscoveryLane {
  return {
    status: "unavailable",
    source: "unavailable",
    sourceUrl: "https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=EN",
    fetchedAt: null,
    items: [],
    message
  };
}

export function unavailableNoticeLeads(message: string, requestedSymbol = "HK.00175"): NoticeLeadDiscoveryLane {
  return {
    status: "unavailable",
    source: "unavailable",
    requestedSymbol,
    fetchedAt: null,
    items: [],
    message
  };
}

export function validateQualifyMarketDiscoveryCandidateRequest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return { ok: false, errors: ["request must be an object"] };
  exact(value, ["candidate", "discoveryFetchedAt"], "request", errors);
  if (record(value.candidate)) exact(value.candidate, [
    "market", "code", "symbol", "name", "industry", "price", "marketCap",
    "average20DayTurnover", "volumeRatio", "fiveDayChangePercent", "asOf", "why"
  ], "request.candidate", errors);
  validateCandidate(value.candidate, value.discoveryFetchedAt, errors);
  instant(value.discoveryFetchedAt, "request.discoveryFetchedAt", errors);
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function validateMarketDiscoveryQualificationEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return { ok: false, errors: ["qualification envelope must be an object"] };
  exact(value, ["schemaVersion", "status", "generatedAt", "symbol", "binding", "facts", "unknowns", "nextChecks", "reproducibility", "message"], "envelope", errors);
  if (value.schemaVersion !== MARKET_DISCOVERY_QUALIFICATION_SCHEMA_VERSION) errors.push("qualification schemaVersion is invalid");
  if (!["available", "conflict", "unavailable"].includes(String(value.status))) errors.push("qualification status is invalid");
  instant(value.generatedAt, "qualification.generatedAt", errors);
  if (typeof value.symbol !== "string" || !/^HK\.\d{5}$/.test(value.symbol)) errors.push("qualification symbol is invalid");
  if (typeof value.message !== "string" || value.message.trim().length === 0) errors.push("qualification message is required");
  if (!Array.isArray(value.facts) || value.facts.length > 4) errors.push("qualification facts are invalid");
  else {
    for (const fact of value.facts) validateQualificationFact(fact, errors);
    const keys = value.facts.flatMap((fact) => record(fact) && typeof fact.key === "string" ? [fact.key] : []);
    if (new Set(keys).size !== keys.length) errors.push("qualification fact keys must be unique");
  }
  stringList(value.unknowns, "qualification.unknowns", 3, errors);
  stringList(value.nextChecks, "qualification.nextChecks", 3, errors);
  if (value.status === "available") {
    validateQualificationBinding(value.binding, value.symbol, value.generatedAt, errors);
    if (!Array.isArray(value.facts) || value.facts.length < 2
      || !Array.isArray(value.unknowns) || value.unknowns.length < 2
      || !Array.isArray(value.nextChecks) || value.nextChecks.length < 2) errors.push("available qualification must retain facts, unknowns, and next checks");
    const reproducibility = record(value.reproducibility) ? value.reproducibility : null;
    const deterministic = reproducibility !== null
      && reproducibility.generationMethod === "deterministic_frozen_fact_framework"
      && ["provider", "model", "prompt", "tokenUsage", "cost"].every((key) => reproducibility[key] === "NOT_USED");
    const deepseek = reproducibility !== null && [
      reproducibility.generationMethod === "deepseek_selected_grounded_discovery_facts",
      reproducibility.provider === "deepseek",
      ["deepseek-v4-flash", "deepseek-flash"].includes(String(reproducibility.model)),
      reproducibility.prompt === "market-discovery-qualification.v1",
      typeof reproducibility.tokenUsage === "string" && /^prompt=\d+,completion=\d+,total=\d+$/.test(reproducibility.tokenUsage),
      reproducibility.cost === "UNKNOWN"
    ].every(Boolean);
    if (!deterministic && !deepseek) errors.push("available qualification reproducibility is invalid");
  } else if (hasNonAvailableQualificationData(value)) {
    errors.push("non-available qualification must clear facts and provider use");
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

function hasNonAvailableQualificationData(value: Record<string, unknown>): boolean {
  return value.binding !== null || Array.isArray(value.facts) && value.facts.length > 0
    || Array.isArray(value.unknowns) && value.unknowns.length > 0 || Array.isArray(value.nextChecks) && value.nextChecks.length > 0
    || !record(value.reproducibility) || value.reproducibility.generationMethod !== "NOT_USED"
    || value.reproducibility.provider !== "NOT_USED" || value.reproducibility.model !== "NOT_USED"
    || value.reproducibility.prompt !== "NOT_USED" || value.reproducibility.tokenUsage !== "NOT_USED"
    || value.reproducibility.cost !== "NOT_USED";
}

export function unavailableMarketDiscoveryQualification(
  symbol: string,
  message: string,
  status: "conflict" | "unavailable" = "unavailable",
  generatedAt = new Date().toISOString()
): MarketDiscoveryQualificationEnvelope {
  return {
    schemaVersion: MARKET_DISCOVERY_QUALIFICATION_SCHEMA_VERSION,
    status,
    generatedAt,
    symbol: /^HK\.\d{5}$/.test(symbol) ? symbol : "HK.00000",
    binding: null,
    facts: [],
    unknowns: [],
    nextChecks: [],
    reproducibility: {
      generationMethod: "NOT_USED",
      provider: "NOT_USED",
      model: "NOT_USED",
      prompt: "NOT_USED",
      tokenUsage: "NOT_USED",
      cost: "NOT_USED"
    },
    message
  };
}

function validateCandidateLane(value: unknown, generatedAt: unknown, errors: string[]): void {
  if (!record(value)) {
    errors.push("candidates must be an object");
    return;
  }
  if (value.status !== "available" && value.status !== "unavailable") errors.push("candidates.status is invalid");
  if (value.source !== "futu_opend_stock_screen_v2" && value.source !== "unavailable") errors.push("candidates.source is invalid");
  if (!record(value.rule) || value.rule.id !== "market_attention_v1" || value.rule.notRecommendation !== true
    || typeof value.rule.summary !== "string" || value.rule.summary.trim().length === 0) errors.push("candidates.rule is invalid");
  if (!Array.isArray(value.candidates) || value.candidates.length > 5000) {
    errors.push("candidates.candidates must contain at most 5000 items");
  } else {
    for (const candidate of value.candidates) validateCandidate(candidate, value.fetchedAt, errors);
    const symbols = value.candidates.flatMap((candidate) => record(candidate) && typeof candidate.symbol === "string" ? [candidate.symbol] : []);
    if (new Set(symbols).size !== symbols.length) errors.push("candidate identities must be unique");
  }
  validateCandidateCoverage(value, errors);
  if (value.status === "unavailable") {
    if (value.source !== "unavailable" || value.fetchedAt !== null || value.totalMatched !== null
      || value.universe !== null || Array.isArray(value.candidates) && value.candidates.length > 0) errors.push("unavailable candidates must clear facts");
  } else {
    instant(value.fetchedAt, "candidates.fetchedAt", errors);
    if (typeof generatedAt === "string" && typeof value.fetchedAt === "string") {
      const age = Date.parse(generatedAt) - Date.parse(value.fetchedAt);
      if (!Number.isFinite(age) || age < 0 || age > MARKET_DISCOVERY_MAX_AGE_MS) errors.push("candidates freshness is invalid");
    }
    if (value.source !== "futu_opend_stock_screen_v2") errors.push("available candidates require Futu source");
    if (!Number.isSafeInteger(value.totalMatched) || Number(value.totalMatched) < 0) errors.push("candidates.totalMatched is invalid");
    validateCandidateUniverse(value.universe, errors);
  }
  if (typeof value.message !== "string" || value.message.trim().length === 0) errors.push("candidates.message is required");
}

function validateCandidateCoverage(value: Record<string, unknown>, errors: string[]): void {
  if (value.coverage !== undefined) {
    const coverage = value.coverage;
    if (!record(coverage) || !["market", "selected_symbol"].includes(String(coverage.scope)) || coverage.complete !== true
      || !Number.isSafeInteger(coverage.scanned) || Number(coverage.scanned) < 0
      || !Array.isArray(value.candidates) || coverage.eligibleMatched !== value.candidates.length
      || Number(coverage.scanned) < Number(coverage.eligibleMatched)
      || coverage.scope === "market" && coverage.scanned !== value.totalMatched) errors.push("candidate coverage is invalid");
    if (record(coverage) && coverage.unavailableSymbols !== undefined) {
      const missing = coverage.unavailableSymbols;
      if (!Array.isArray(missing) || missing.length > 5000
        || missing.some((symbol) => typeof symbol !== "string" || !/^HK\.\d{5}$/.test(symbol))
        || new Set(missing).size !== missing.length) errors.push("candidate unavailable identities are invalid");
    }
  }
}

export function candidateDiscoveryUniverseIsValid(value: unknown): value is CandidateDiscoveryUniverse {
  if (!record(value)) return false;
  return value.source === "hkex_sse_szse_southbound_official"
    && typeof value.snapshotId === "string" && /^[a-f0-9]{64}$/.test(value.snapshotId)
    && typeof value.effectiveDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.effectiveDate)
    && typeof value.capturedAt === "string" && isRfc3339DateTime(value.capturedAt)
    && Number.isSafeInteger(value.memberCount) && Number(value.memberCount) >= 2
    && Array.isArray(value.sourceUrls) && value.sourceUrls.length === 2
    && value.sourceUrls[0] === "https://www.sse.com.cn/services/hkexsc/disclo/eligible/"
    && value.sourceUrls[1] === "https://www.szse.cn/szhk/hkbussiness/underlylist/";
}
function validateMarketDiscoveryEligibility(value: unknown, expectedSymbol: string, errors: string[]): void {
  if (!record(value)) { errors.push("eligibility must be an object"); return; }
  exact(value, ["requestedSymbol", "status", "universe", "message"], "eligibility", errors);
  if (value.requestedSymbol !== expectedSymbol) errors.push("eligibility requestedSymbol is invalid");
  if (!["eligible", "not_eligible", "unknown"].includes(String(value.status))) errors.push("eligibility status is invalid");
  if (typeof value.message !== "string" || value.message.trim().length === 0) errors.push("eligibility message is required");
  if (value.status === "unknown" ? value.universe !== null : !candidateDiscoveryUniverseIsValid(value.universe)) errors.push("eligibility universe is invalid for its status");
}
function validateCandidateUniverse(value: unknown, errors: string[]): void { if (!candidateDiscoveryUniverseIsValid(value)) errors.push("candidates.universe is invalid"); }
function sameCandidateDiscoveryUniverse(left: unknown, right: unknown): boolean {
  return candidateDiscoveryUniverseIsValid(left) && candidateDiscoveryUniverseIsValid(right)
    && left.snapshotId === right.snapshotId && left.effectiveDate === right.effectiveDate
    && left.capturedAt === right.capturedAt && left.memberCount === right.memberCount
    && left.sourceUrls.every((url, index) => url === right.sourceUrls[index]);
}

function validateCandidate(value: unknown, fetchedAt: unknown, errors: string[]): void {
  if (!record(value)) {
    errors.push("candidate must be an object");
    return;
  }
  if (value.market !== "HK" || typeof value.code !== "string" || !/^\d{5}$/.test(value.code)
    || value.symbol !== `HK.${value.code}`) errors.push("candidate identity is invalid");
  for (const key of ["name", "asOf", "why"] as const) {
    if (typeof value[key] !== "string" || value[key].trim().length === 0) errors.push(`candidate.${key} is required`);
  }
  if (!(value.industry === null || typeof value.industry === "string" && value.industry.trim().length > 0)) errors.push("candidate.industry is invalid");
  for (const key of ["price", "marketCap", "average20DayTurnover", "volumeRatio", "fiveDayChangePercent"] as const) {
    if (typeof value[key] !== "number" || !Number.isFinite(value[key])) errors.push(`candidate.${key} must be finite`);
  }
  if (typeof value.price === "number" && value.price <= 0 || typeof value.marketCap === "number" && value.marketCap <= 0
    || typeof value.average20DayTurnover === "number" && value.average20DayTurnover < 0
    || typeof value.volumeRatio === "number" && value.volumeRatio < 0) errors.push("candidate numeric bounds are invalid");
  instant(value.asOf, "candidate.asOf", errors);
  if (typeof fetchedAt === "string" && typeof value.asOf === "string"
    && Date.parse(value.asOf) > Date.parse(fetchedAt)) errors.push("candidate.asOf must not be after candidates.fetchedAt");
}

function validateQualificationFact(value: unknown, errors: string[]): void {
  if (!record(value)) {
    errors.push("qualification fact must be an object");
    return;
  }
  exact(value, ["key", "label", "value", "meaning"], "qualification fact", errors);
  if (!["screen_match", "price", "market_cap", "turnover", "volume_ratio", "five_day_change", "industry"].includes(String(value.key))) {
    errors.push("qualification fact key is invalid");
  }
  for (const key of ["label", "value", "meaning"] as const) {
    if (typeof value[key] !== "string" || value[key].trim().length === 0 || value[key].length > 500) {
      errors.push(`qualification fact ${key} is invalid`);
    }
  }
}

function validateQualificationBinding(value: unknown, symbol: unknown, generatedAt: unknown, errors: string[]): void {
  if (!record(value)) {
    errors.push("qualification binding is required");
    return;
  }
  exact(value, ["source", "ruleId", "discoveryFetchedAt", "candidateAsOf", "candidateFingerprint"], "qualification binding", errors);
  if (value.source !== "futu_opend_stock_screen_v2" || value.ruleId !== "market_attention_v1") errors.push("qualification binding source is invalid");
  instant(value.discoveryFetchedAt, "qualification.binding.discoveryFetchedAt", errors);
  instant(value.candidateAsOf, "qualification.binding.candidateAsOf", errors);
  if (typeof generatedAt === "string" && typeof value.discoveryFetchedAt === "string" && typeof value.candidateAsOf === "string"
    && (Date.parse(value.candidateAsOf) > Date.parse(value.discoveryFetchedAt)
      || Date.parse(value.discoveryFetchedAt) > Date.parse(generatedAt))) errors.push("qualification binding chronology is invalid");
  if (typeof value.candidateFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.candidateFingerprint)) errors.push("qualification fingerprint is invalid");
  if (typeof symbol !== "string" || !/^HK\.\d{5}$/.test(symbol)) errors.push("qualification binding symbol is invalid");
}

function stringList(value: unknown, key: string, maximum: number, errors: string[]): void {
  if (!Array.isArray(value) || value.length > maximum || value.some((item) => typeof item !== "string" || item.trim().length === 0 || item.length > 500)) {
    errors.push(`${key} is invalid`);
    return;
  }
  if (new Set(value).size !== value.length) errors.push(`${key} must be unique`);
}

function exact(value: Record<string, unknown>, allowed: string[], key: string, errors: string[]): void {
  const allowedKeys = new Set(allowed);
  for (const actual of Object.keys(value)) if (!allowedKeys.has(actual)) errors.push(`${key}.${actual} is not allowed`);
  for (const required of allowed) if (!Object.prototype.hasOwnProperty.call(value, required)) errors.push(`${key}.${required} is required`);
}

function validateAnnouncementLane(value: unknown, expectedSymbol: string, errors: string[]): void {
  if (!record(value)) {
    errors.push("announcements must be an object");
    return;
  }
  if (value.status !== "available" && value.status !== "unavailable") errors.push("announcements.status is invalid");
  if (value.source !== "hkexnews_official" && value.source !== "unavailable") errors.push("announcements.source is invalid");
  if (typeof value.sourceUrl !== "string" || !/^https:\/\/www1\.hkexnews\.hk\/search\/titlesearch\.xhtml\?lang=EN(?:&market=SEHK&stockId=[1-9]\d*)?$/.test(value.sourceUrl)) {
    errors.push("announcements.sourceUrl is invalid");
  }
  if (!Array.isArray(value.items) || value.items.length > 10) errors.push("announcements.items must contain at most 10 items");
  else {
    for (const item of value.items) validateAnnouncement(item, expectedSymbol, errors);
    const ids = value.items.flatMap((item) => record(item) && typeof item.id === "string" ? [item.id] : []);
    if (new Set(ids).size !== ids.length) errors.push("announcement identities must be unique");
  }
  if (value.status === "unavailable") {
    if (value.source !== "unavailable" || value.fetchedAt !== null || Array.isArray(value.items) && value.items.length > 0) {
      errors.push("unavailable announcements must clear facts");
    }
  } else {
    instant(value.fetchedAt, "announcements.fetchedAt", errors);
    if (value.source !== "hkexnews_official" || !String(value.sourceUrl).includes("&stockId=")) errors.push("available announcements require HKEXnews source");
  }
  if (typeof value.message !== "string" || value.message.trim().length === 0) errors.push("announcements.message is required");
}

function validateAnnouncement(value: unknown, expectedSymbol: string, errors: string[]): void {
  if (!record(value)) {
    errors.push("announcement must be an object");
    return;
  }
  if (typeof value.id !== "string" || !/^[a-f0-9]{64}$/.test(value.id)) errors.push("announcement.id is invalid");
  if (!/^HK\.\d{5}$/.test(expectedSymbol) || value.symbol !== expectedSymbol) errors.push("announcement.symbol is invalid");
  if (typeof value.title !== "string" || value.title.trim().length === 0 || value.title.length > 500) errors.push("announcement.title is required");
  if (typeof value.publishedDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.publishedDate)
    || !Number.isFinite(Date.parse(`${value.publishedDate}T00:00:00Z`))) errors.push("announcement.publishedDate is invalid");
  if (typeof value.documentUrl !== "string" || !/^https:\/\/www1\.hkexnews\.hk\/listedco\/listconews\/sehk\/\d{4}\/\d{4}\/\d+\.pdf$/i.test(value.documentUrl)) {
    errors.push("announcement.documentUrl is invalid");
  }
  if (!["financial_report", "corporate_action", "business_change", "administrative", "other"].includes(String(value.category))) errors.push("announcement.category is invalid");
  if (typeof value.why !== "string" || value.why.trim().length === 0) errors.push("announcement.why is required");
}

function validateNoticeLane(value: unknown, generatedAt: unknown, requestedSymbol: string, errors: string[]): void {
  if (!record(value)) {
    errors.push("notices must be an object");
    return;
  }
  if (value.status !== "available" && value.status !== "unavailable") errors.push("notices.status is invalid");
  if (value.source !== "futu_opend_search_news_information" && value.source !== "unavailable") errors.push("notices.source is invalid");
  if (!/^HK\.\d{5}$/.test(requestedSymbol) || value.requestedSymbol !== requestedSymbol) errors.push("notices.requestedSymbol is invalid");
  if (!Array.isArray(value.items) || value.items.length > 10) errors.push("notices.items must contain at most 10 items");
  else {
    for (const item of value.items) validateNotice(item, value.fetchedAt, generatedAt, requestedSymbol, errors);
    const ids = value.items.flatMap((item) => record(item) && typeof item.id === "string" ? [item.id] : []);
    if (new Set(ids).size !== ids.length) errors.push("information lead identities must be unique");
  }
  if (value.status === "unavailable") {
    if (value.source !== "unavailable" || value.fetchedAt !== null || Array.isArray(value.items) && value.items.length > 0) {
      errors.push("unavailable information leads must clear facts");
    }
  } else {
    rfc3339Instant(value.fetchedAt, "notices.fetchedAt", errors);
    if (value.source !== "futu_opend_search_news_information") errors.push("available information leads require OpenD source");
    if (typeof generatedAt === "string" && typeof value.fetchedAt === "string") {
      const age = Date.parse(generatedAt) - Date.parse(value.fetchedAt);
      if (!Number.isFinite(age) || age < 0 || age > MARKET_DISCOVERY_MAX_AGE_MS) errors.push("NOTICE lane freshness is invalid");
    }
  }
  if (typeof value.message !== "string" || value.message.trim().length === 0) errors.push("notices.message is required");
}

function validateNotice(value: unknown, fetchedAt: unknown, generatedAt: unknown, requestedSymbol: string, errors: string[]): void {
  if (!record(value)) {
    errors.push("information lead must be an object");
    return;
  }
  if (typeof value.id !== "string" || !/^[a-f0-9]{64}$/.test(value.id)) errors.push("information lead id is invalid");
  if (value.kind !== "notice" && value.kind !== "major_news") errors.push("information lead kind is invalid");
  if (value.symbol !== requestedSymbol) errors.push("information lead symbol is invalid");
  if (typeof value.title !== "string" || value.title.trim().length === 0 || value.title.length > 500) errors.push("information lead title is invalid");
  if (typeof value.source !== "string" || value.source.trim().length === 0 || value.source.length > 200) errors.push("information lead source is invalid");
  rfc3339Instant(value.publishedAt, "information lead publishedAt", errors);
  if (typeof fetchedAt === "string" && typeof value.publishedAt === "string"
    && Date.parse(value.publishedAt) > Date.parse(fetchedAt)) errors.push("information lead publish time is in the future");
  if (typeof generatedAt === "string" && typeof value.publishedAt === "string"
    && Date.parse(value.publishedAt) > Date.parse(generatedAt)) errors.push("information lead chronology is invalid");
  if (!Array.isArray(value.relatedSecurities)
    || (value.relatedSecurities.length > 0 && !value.relatedSecurities.includes(requestedSymbol))
    || value.relatedSecurities.some((item) => typeof item !== "string" || !/^[A-Z]{2,4}\.[A-Z0-9]{1,20}$/.test(item))
    || new Set(value.relatedSecurities).size !== value.relatedSecurities.length) errors.push("information lead related securities are invalid");
  if (typeof value.url !== "string" || !safeHttpsUrl(value.url)) errors.push("information lead URL is invalid");
  if (value.evidenceStatus !== "unverified_source_lead") errors.push("information lead must remain unverified");
}

function instant(value: unknown, key: string, errors: string[]): void {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) errors.push(`${key} must be a date-time`);
}

function rfc3339Instant(value: unknown, key: string, errors: string[]): void {
  if (typeof value !== "string" || !isRfc3339DateTime(value) || !Number.isFinite(Date.parse(value))) {
    errors.push(`${key} must be an RFC3339 date-time`);
  }
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

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
