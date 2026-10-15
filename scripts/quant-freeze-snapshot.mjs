#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadHkConnectUniverse } from "./hk-connect-universe-binding.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = process.env.QUANT_FREEZE_CONFIG ?? "config/quant-freeze-snapshot.hk-09926.json";
const config = JSON.parse(await readText(configPath));
const configQuality = checkConfig(config);
const fatalConfigIssues = configQuality.issues.filter((issue) => issue.level === "error" && issue.fatal !== false);
if (fatalConfigIssues.length > 0) {
  const result = {
    ok: false,
    goNoGo: "no_go_fix_snapshot_config",
    configPath,
    configQuality
  };
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
let hkConnectUniverse = null;
if (config.hkConnectUniversePath) {
  try {
    hkConnectUniverse = await loadHkConnectUniverse(config.hkConnectUniversePath);
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      goNoGo: "no_go_invalid_hk_connect_universe",
      configPath,
      reason: error instanceof Error ? error.message : "Hong Kong Connect universe is invalid"
    }, null, 2));
    process.exit(1);
  }
  if (config.universe.some((item) => !hkConnectUniverse.members.has(item.symbol))) {
    console.error(JSON.stringify({ ok: false, goNoGo: "no_go_symbol_outside_hk_connect_universe", configPath }, null, 2));
    process.exit(1);
  }
}
const sourceText = await readText(config.sourcePath);
const source = JSON.parse(sourceText);
const generatedAt = config.sourceIdentity.fetchedAt;

const sourceHash = sha256(sourceText);
const bars = normalizeBars(extractSourceBars(source, config));
const selectedBars = bars.filter((bar) => (
  bar.market === config.market &&
  config.universe.some((item) => item.code === bar.code) &&
  bar.tradeDate >= config.dateRange.start &&
  bar.tradeDate <= config.dateRange.end
));
const dataQuality = checkDataQuality(selectedBars, config);
const configBlockerCount = configQuality.issues.filter((issue) => issue.level === "error").length;
const dataBlockerCount = dataQuality.issues.filter((issue) => issue.level === "error").length;
const blockerCount = configBlockerCount + dataBlockerCount;

if (blockerCount > 0) {
  const result = {
    ok: false,
    goNoGo: "no_go_fix_snapshot_quality",
    configPath,
    sourcePath: config.sourcePath,
    sourceHash,
    configQuality,
    dataQuality
  };
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}

const canonicalBars = selectedBars.map((bar) => ({
  market: bar.market,
  code: bar.code,
  tradeDate: bar.tradeDate,
  open: bar.open,
  high: bar.high,
  low: bar.low,
  close: bar.close,
  volume: bar.volume,
  turnover: bar.turnover,
  adjustment: config.adjustment,
  source: config.sourceKind,
  fetchedAt: bar.fetchedAt
}));
const universeKey = config.universe.map((item) => `${item.market}.${item.code}`).join("-");
const canonicalPayload = {
  schemaVersion: "2026-06-20.quant-snapshot.v1",
  sourceKind: config.sourceKind,
  sourcePath: config.sourcePath,
  sourceHash,
  adjustment: config.adjustment,
  dataCutoff: config.dataCutoff,
  ...(hkConnectUniverse ? { hkConnectUniverse: hkConnectUniverse.binding } : {}),
  universe: config.universe,
  dateRange: {
    start: canonicalBars.reduce((min, bar) => min === null || bar.tradeDate < min ? bar.tradeDate : min, null),
    end: canonicalBars.reduce((max, bar) => max === null || bar.tradeDate > max ? bar.tradeDate : max, null)
  },
  bars: canonicalBars
};
const dataHash = sha256(stableJson(canonicalPayload));
const sourceIdentity = {
  ...config.sourceIdentity,
  source: config.sourceIdentity.source,
  sourceKind: config.sourceKind,
  sourcePath: config.sourcePath,
  sourceHash,
  asOf: config.sourceIdentity.asOf,
  fetchedAt: config.sourceIdentity.fetchedAt
};
const snapshotId = [
  config.market.toLowerCase(),
  universeKey.replace(/[^A-Za-z0-9.-]+/g, "-").toLowerCase(),
  config.adjustment,
  canonicalPayload.dateRange.start,
  canonicalPayload.dateRange.end,
  dataHash.slice(0, 12)
].join("-");

const snapshot = {
  snapshotId,
  generatedAt,
  sourceIdentity,
  sourceClassification: sourceIdentity.classification,
  source: config.sourceKind,
  sourcePath: config.sourcePath,
  sourceHash,
  dataHash,
  snapshotHash: null,
  adjustment: config.adjustment,
  dataCutoff: config.dataCutoff,
  ...(hkConnectUniverse ? { hkConnectUniverse: hkConnectUniverse.binding } : {}),
  universe: config.universe,
  dateRange: canonicalPayload.dateRange,
  quality: dataQuality,
  authority: {
    type: "research_only",
    advisoryOnly: true,
    officialPortfolioFact: false,
    officialReviewFact: false,
    ranking: false,
    recommendation: false,
    score: false,
    allocation: false,
    sizing: false,
    targetPrice: false,
    buySellHold: false,
    orderTradeFill: false,
    cashFeePositionMutation: false,
    brokerWrite: false,
    productionWrite: false
  },
  limitations: sourceIdentity.classification === "approved_real_historical"
    ? [
        "approved real historical research snapshot; not live market or account state",
        "research-adjusted prices do not replace dividend, split, cash, position, or fee accounting",
        "research evidence only, not trading advice",
        "not an official portfolio, position, cash, fee, order, trade, fill, or review fact"
      ]
    : [
        "repository-local frozen snapshot foundation only",
        "fixture data is not live market data",
        "research evidence only, not trading advice",
        "not an official portfolio, position, cash, fee, order, trade, fill, or review fact"
      ],
  safety: {
    sendsLiveNetworkRequests: false,
    writesProductionDatabase: false,
    enablesTrading: false,
    initializesBrokerGateway: false,
    mutatesOfficialPortfolio: false,
    mutatesOfficialReview: false
  },
  bars: canonicalBars
};
snapshot.snapshotHash = computeSnapshotHash(snapshot);
const outputDir = resolvePath(config.outputDir);
const outputPath = join(outputDir, `${snapshotId}.snapshot.json`);
const manifestPath = join(outputDir, `${snapshotId}.manifest.json`);
const manifest = {
  schemaVersion: "2026-07-09.quant-freeze-manifest.v2",
  generatedAt,
  configPath,
  configHash: sha256(await readText(configPath)),
  sourceIdentity,
  sourceClassification: sourceIdentity.classification,
  sourcePath: config.sourcePath,
  sourceHash,
  outputPath: relative(outputPath),
  snapshotId,
  dataHash,
  snapshotHash: snapshot.snapshotHash,
  rows: canonicalBars.length,
  universe: config.universe,
  dateRange: canonicalPayload.dateRange,
  adjustment: config.adjustment,
  dataCutoff: config.dataCutoff,
  ...(hkConnectUniverse ? { hkConnectUniverse: hkConnectUniverse.binding } : {}),
  dataQuality,
  authority: snapshot.authority,
  limitations: snapshot.limitations,
  safety: {
    sendsLiveNetworkRequests: false,
    writesProductionDatabase: false,
    enablesTrading: false,
    initializesBrokerGateway: false,
    mutatesOfficialPortfolio: false,
    mutatesOfficialReview: false
  }
};

await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, JSON.stringify(snapshot, null, 2) + "\n");
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

console.log(JSON.stringify({
  ok: true,
  goNoGo: "quant_snapshot_frozen",
  outputPath: relative(outputPath),
  manifestPath: relative(manifestPath),
  snapshotId,
  dataHash,
  snapshotHash: snapshot.snapshotHash,
  sourceIdentity,
  sourceClassification: sourceIdentity.classification,
  authority: snapshot.authority,
  rows: canonicalBars.length,
  dateRange: canonicalPayload.dateRange,
  safety: manifest.safety
}, null, 2));

function extractSourceBars(rawSource, cfg) {
  if (Array.isArray(rawSource)) return rawSource;
  const rawBars = rawSource.bars
    ?? rawSource.data?.bars
    ?? rawSource.history?.bars
    ?? rawSource.marketData?.history?.bars
    ?? rawSource.payload?.bars
    ?? [];
  return rawBars.map((bar) => ({
    market: bar.market ?? rawSource.market ?? cfg.market,
    code: bar.code ?? rawSource.code ?? rawSource.ticker ?? cfg.universe[0]?.code,
    tradeDate: bar.tradeDate ?? bar.date ?? bar.time_key ?? bar.timeKey,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    turnover: bar.turnover ?? bar.turnoverRateValue ?? bar.amount,
    fetchedAt: bar.fetchedAt ?? rawSource.fetchedAt ?? rawSource.exportedAt ?? rawSource.export?.fetchedAt
  }));
}

function normalizeBars(rawBars) {
  return rawBars.map((bar) => ({
    market: String(bar.market ?? "").toUpperCase(),
    code: String(bar.code ?? "").padStart(5, "0"),
    tradeDate: String(bar.tradeDate ?? ""),
    open: Number(bar.open),
    high: Number(bar.high),
    low: Number(bar.low),
    close: Number(bar.close),
    volume: Number(bar.volume),
    turnover: Number(bar.turnover),
    fetchedAt: bar.fetchedAt
  })).sort((a, b) => `${a.market}.${a.code}.${a.tradeDate}`.localeCompare(`${b.market}.${b.code}.${b.tradeDate}`));
}

function checkConfig(cfg) {
  const issues = [];
  const sourceIdentity = cfg.sourceIdentity ?? null;
  const seenUniverse = new Set();
  const validSourceClassifications = new Set(["fixture", "fixture_market_data_export", "approved_real_historical"]);

  if (cfg.schemaVersion !== "2026-06-20.quant-freeze-snapshot.v1") {
    issues.push({ level: "error", type: "invalid_schema_version", schemaVersion: cfg.schemaVersion });
  }
  if (cfg.market !== "HK") {
    issues.push({ level: "error", type: "non_hk_market", market: cfg.market });
  }
  if (!["none", "forward", "backward"].includes(cfg.adjustment)) {
    issues.push({ level: "error", type: "unsupported_adjustment", adjustment: cfg.adjustment });
  }
  if (!sourceIdentity || typeof sourceIdentity !== "object") {
    issues.push({ level: "error", type: "missing_source_identity" });
  } else {
    if (sourceIdentity.source !== cfg.sourceKind) {
      issues.push({ level: "error", type: "source_identity_mismatch", source: sourceIdentity.source, sourceKind: cfg.sourceKind });
    }
    if (!validSourceClassifications.has(sourceIdentity.classification)) {
      issues.push({ level: "error", type: "unsupported_source_classification", classification: sourceIdentity.classification });
    }
    const realHistorical = sourceIdentity.classification === "approved_real_historical";
    if (realHistorical && !nonPlaceholder(sourceIdentity.provenance)) issues.push({ level: "error", type: "missing_real_source_provenance" });
    if (!realHistorical && sourceIdentity.provenance !== "repository_local_fixture") issues.push({ level: "error", type: "unsupported_source_provenance", provenance: sourceIdentity.provenance });
    if (sourceIdentity.authority !== "research_only") {
      issues.push({ level: "error", type: "unsafe_source_authority", authority: sourceIdentity.authority });
    }
    if (realHistorical && (!nonPlaceholder(sourceIdentity.authorizationId) || sourceIdentity.externalFetch !== true)) {
      issues.push({ level: "error", type: "missing_real_source_authorization" });
    }
    if (!realHistorical && sourceIdentity.externalFetch !== false) {
      issues.push({ level: "error", type: "external_fetch_not_authorized", externalFetch: sourceIdentity.externalFetch });
    }
    if (!isStrictIsoInstant(sourceIdentity.asOf)) {
      issues.push({ level: "error", type: "invalid_source_as_of", asOf: sourceIdentity.asOf });
    }
    if (!isStrictIsoInstant(sourceIdentity.fetchedAt)) {
      issues.push({ level: "error", type: "invalid_source_fetched_at", fetchedAt: sourceIdentity.fetchedAt });
    }
  }
  if (typeof cfg.sourcePath !== "string" || cfg.sourcePath.trim() === "" || /^[a-z][a-z0-9+.-]*:\/\//i.test(cfg.sourcePath)) {
    issues.push({ level: "error", type: "source_path_not_local_fixture", sourcePath: cfg.sourcePath });
  } else if (sourceIdentity?.classification === "approved_real_historical" && !String(cfg.sourcePath).startsWith("data/quant-approved/")) {
    issues.push({ level: "error", type: "real_source_path_not_approved_data", sourcePath: cfg.sourcePath });
  } else if (sourceIdentity?.classification !== "approved_real_historical" && !String(cfg.sourcePath).startsWith("data/quant-fixtures/")) {
    issues.push({ level: "error", fatal: false, type: "source_path_not_repository_fixture", sourcePath: cfg.sourcePath });
  }
  if (cfg.hkConnectUniversePath !== undefined
    && (typeof cfg.hkConnectUniversePath !== "string" || cfg.hkConnectUniversePath.trim() === "")) {
    issues.push({ level: "error", type: "invalid_hk_connect_universe_path" });
  }
  if (!isStrictIsoInstant(cfg.dataCutoff)) {
    issues.push({ level: "error", type: "invalid_data_cutoff", dataCutoff: cfg.dataCutoff });
  }
  if (!cfg.dateRange || typeof cfg.dateRange !== "object") {
    issues.push({ level: "error", type: "missing_date_range" });
  } else {
    if (!isStrictDate(cfg.dateRange.start)) {
      issues.push({ level: "error", type: "invalid_date_range_start", start: cfg.dateRange.start });
    }
    if (!isStrictDate(cfg.dateRange.end)) {
      issues.push({ level: "error", type: "invalid_date_range_end", end: cfg.dateRange.end });
    }
    if (isStrictDate(cfg.dateRange.start) && isStrictDate(cfg.dateRange.end) && cfg.dateRange.start > cfg.dateRange.end) {
      issues.push({ level: "error", type: "invalid_date_range_order", start: cfg.dateRange.start, end: cfg.dateRange.end });
    }
  }
  if (!Array.isArray(cfg.universe) || cfg.universe.length === 0) {
    issues.push({ level: "error", type: "missing_universe" });
  } else {
    for (const item of cfg.universe) {
      const key = `${item.market}.${item.code}`;
      if (seenUniverse.has(key)) {
        issues.push({ level: "error", type: "duplicate_universe_symbol", symbol: key });
      }
      seenUniverse.add(key);
      if (item.market !== "HK") {
        issues.push({ level: "error", type: "non_hk_universe_symbol", symbol: key });
      }
      if (!/^\d{5}$/.test(String(item.code ?? "")) || item.symbol !== `HK.${item.code}`) {
        issues.push({ level: "error", type: "invalid_universe_symbol_identity", symbol: item.symbol, code: item.code });
      }
    }
  }

  return {
    ok: issues.every((issue) => issue.level !== "error"),
    issues
  };
}

function nonPlaceholder(value) {
  return typeof value === "string" && value.trim().length > 0 && !/^(unknown|missing|none|n\/?a|unavailable|placeholder|example|fixture|synthetic)$/i.test(value.trim());
}

function checkDataQuality(items, cfg) {
  const issues = [];
  const seen = new Set();
  const expectedSymbols = new Set(cfg.universe.map((item) => `${item.market}.${item.code}`));
  const cutoffMs = Date.parse(cfg.dataCutoff);
  if (!isStrictIsoInstant(cfg.dataCutoff)) {
    issues.push({ level: "error", type: "invalid_data_cutoff", dataCutoff: cfg.dataCutoff });
  }
  for (const item of cfg.universe) {
    if (!Number.isInteger(Number(item.lotSize)) || Number(item.lotSize) <= 0) {
      issues.push({ level: "error", type: "invalid_lot_size", symbol: item.symbol, lotSize: item.lotSize });
    }
  }
  for (const symbol of expectedSymbols) {
    const count = items.filter((bar) => `${bar.market}.${bar.code}` === symbol).length;
    if (count === 0) issues.push({ level: "error", type: "missing_symbol_bars", symbol });
  }
  for (let index = 0; index < items.length; index += 1) {
    const bar = items[index];
    const key = `${bar.market}.${bar.code}.${bar.tradeDate}`;
    if (seen.has(key)) issues.push({ level: "error", type: "duplicate_bar", key });
    seen.add(key);
    if (!isStrictDate(bar.tradeDate)) {
      issues.push({ level: "error", type: "invalid_trade_date", key });
    }
    const previous = items[index - 1];
    if (previous && previous.market === bar.market && previous.code === bar.code && previous.tradeDate >= bar.tradeDate) {
      issues.push({ level: "error", type: "date_not_increasing", key });
    }
    for (const field of ["open", "high", "low", "close"]) {
      if (!Number.isFinite(bar[field]) || bar[field] <= 0) {
        issues.push({ level: "error", type: "invalid_price", key, field });
      }
    }
    if (bar.high < bar.low || bar.high < bar.open || bar.high < bar.close || bar.low > bar.open || bar.low > bar.close) {
      issues.push({ level: "error", type: "invalid_ohlc", key });
    }
    if (!Number.isFinite(bar.volume) || bar.volume <= 0) {
      issues.push({ level: "warning", type: "not_tradeable_volume", key });
    }
    if (!Number.isFinite(bar.turnover) || bar.turnover < 0) {
      issues.push({ level: "warning", type: "invalid_turnover", key });
    }
    const fetchedAtMs = Date.parse(bar.fetchedAt);
    if (!isStrictIsoInstant(bar.fetchedAt)) {
      issues.push({ level: "error", type: "invalid_fetched_at", key, fetchedAt: bar.fetchedAt });
    } else if (Number.isFinite(cutoffMs) && fetchedAtMs > cutoffMs) {
      issues.push({
        level: "error",
        type: "fetched_after_data_cutoff",
        key,
        fetchedAt: bar.fetchedAt,
        dataCutoff: cfg.dataCutoff
      });
    }
  }
  return {
    ok: issues.every((issue) => issue.level !== "error"),
    rows: items.length,
    duplicateCount: issues.filter((issue) => issue.type === "duplicate_bar").length,
    missingSymbolCount: issues.filter((issue) => issue.type === "missing_symbol_bars").length,
    notTradeableCount: issues.filter((issue) => issue.type === "not_tradeable_volume").length,
    issues
  };
}

function computeSnapshotHash(snapshot) {
  return sha256(stableJson({
    schemaVersion: "2026-07-09.quant-frozen-snapshot-identity.v1",
    snapshotId: snapshot.snapshotId,
    sourceIdentity: snapshot.sourceIdentity,
    sourceClassification: snapshot.sourceClassification,
    source: snapshot.source,
    sourcePath: snapshot.sourcePath,
    sourceHash: snapshot.sourceHash,
    dataHash: snapshot.dataHash,
    adjustment: snapshot.adjustment,
    dataCutoff: snapshot.dataCutoff,
    ...(snapshot.hkConnectUniverse ? { hkConnectUniverse: snapshot.hkConnectUniverse } : {}),
    universe: snapshot.universe,
    dateRange: snapshot.dateRange,
    authority: snapshot.authority,
    limitations: snapshot.limitations,
    safety: snapshot.safety,
    bars: snapshot.bars
  }));
}

function isStrictDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isStrictIsoInstant(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(String(value))) return false;
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

async function readText(path) {
  return readFile(resolvePath(path), "utf8");
}

function resolvePath(path) {
  return String(path).startsWith("/") ? String(path) : join(root, String(path));
}

function relative(path) {
  return path.startsWith(root) ? path.slice(root.length + 1) : path;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  return JSON.stringify(sortObject(value));
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
  }
  return value;
}
