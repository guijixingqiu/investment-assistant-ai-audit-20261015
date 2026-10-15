#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { frozenSnapshotMatchesHkConnectUniverse, loadHkConnectUniverse } from "./hk-connect-universe-binding.mjs";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = process.env.QUANT_FREEZE_CONFIG ?? "config/quant-freeze-snapshot.hk-09926.json";
const config = JSON.parse(await readText(configPath));

let freeze = process.env.QUANT_SNAPSHOT_VERIFY_NO_FREEZE === "1"
  ? {
      ok: true,
      goNoGo: "quant_snapshot_bound_for_verify",
      outputPath: process.env.QUANT_SNAPSHOT_PATH,
      manifestPath: process.env.QUANT_SNAPSHOT_MANIFEST_PATH
    }
  : await runFreeze();
if (!freeze.outputPath || !freeze.manifestPath) {
  console.error(JSON.stringify({
    ok: false,
    goNoGo: "no_go_missing_snapshot_verify_paths",
    configPath,
    outputPath: freeze.outputPath ?? null,
    manifestPath: freeze.manifestPath ?? null
  }, null, 2));
  process.exit(1);
}
const snapshot = JSON.parse(await readText(freeze.outputPath));
const manifest = JSON.parse(await readText(freeze.manifestPath));
const snapshotText = await readText(freeze.outputPath);
let hkConnectUniverse = null;
let hkConnectUniverseError = null;
if (config.hkConnectUniversePath) {
  try {
    hkConnectUniverse = await loadHkConnectUniverse(config.hkConnectUniversePath);
  } catch (error) {
    hkConnectUniverseError = error instanceof Error ? error.message : "Hong Kong Connect universe is invalid";
  }
}
freeze = {
  ...freeze,
  snapshotId: freeze.snapshotId ?? snapshot.snapshotId,
  dataHash: freeze.dataHash ?? snapshot.dataHash,
  snapshotHash: freeze.snapshotHash ?? snapshot.snapshotHash,
  rows: freeze.rows ?? (Array.isArray(snapshot.bars) ? snapshot.bars.length : null)
};
const checks = [];

check(
  "freeze or bound snapshot command succeeded",
  freeze.ok === true && ["quant_snapshot_frozen", "quant_snapshot_bound_for_verify"].includes(freeze.goNoGo),
  freeze.outputPath
);
check("manifest points at the frozen snapshot", manifest.outputPath === freeze.outputPath, freeze.manifestPath);
check("snapshot id is consistent", snapshot.snapshotId === manifest.snapshotId && snapshot.snapshotId === freeze.snapshotId, freeze.outputPath);
check("data hash is consistent", snapshot.dataHash === manifest.dataHash && snapshot.dataHash === freeze.dataHash, freeze.outputPath);
check("snapshot hash is consistent", snapshot.snapshotHash === manifest.snapshotHash && snapshot.snapshotHash === freeze.snapshotHash, freeze.outputPath);
check("row count is consistent", Array.isArray(snapshot.bars) && snapshot.bars.length === manifest.rows && snapshot.bars.length === freeze.rows, freeze.outputPath);

const canonicalDataHash = computeDataHash(snapshot);
const canonicalSnapshotHash = computeSnapshotHash(snapshot);
const expectedSnapshotId = buildSnapshotId(snapshot, canonicalDataHash);
const snapshotFileHash = sha256(snapshotText);

check("canonical data hash matches", canonicalDataHash === snapshot.dataHash, freeze.outputPath);
check("canonical snapshot hash matches", canonicalSnapshotHash === snapshot.snapshotHash, freeze.outputPath);
check("snapshot id binds canonical hash", expectedSnapshotId === snapshot.snapshotId, freeze.outputPath);
check("manifest carries fixture-vs-real source classification", manifest.sourceClassification === snapshot.sourceClassification, freeze.manifestPath);
check(
  "official Hong Kong Connect universe is content-addressed and immutable",
  !config.hkConnectUniversePath || hkConnectUniverse !== null,
  hkConnectUniverseError ?? config.hkConnectUniversePath ?? "legacy snapshot without Hong Kong Connect binding"
);
check(
  "official Hong Kong Connect universe binding and symbol subset are preserved",
  config.hkConnectUniversePath
    ? hkConnectUniverse !== null && frozenSnapshotMatchesHkConnectUniverse(hkConnectUniverse, snapshot, manifest)
    : snapshot.hkConnectUniverse === undefined && manifest.hkConnectUniverse === undefined,
  freeze.manifestPath
);
check("source identity is explicit", isValidSourceIdentity(snapshot.sourceIdentity, snapshot), freeze.outputPath);
check("source artifact location matches classification", isApprovedSourceLocation(snapshot), freeze.outputPath);
check("authority is research-only", isResearchOnlyAuthority(snapshot.authority), freeze.outputPath);
check("safety has no trading or official mutations", isNoWriteSafety(snapshot.safety) && isNoWriteSafety(manifest.safety), freeze.outputPath);
check("manifest cannot mark production or release ready", !manifest.releaseReady && !manifest.productionReady, freeze.manifestPath);

const blockers = checks.filter((item) => !item.ok);
const result = {
  ok: blockers.length === 0,
  goNoGo: blockers.length === 0 ? "quant_frozen_snapshot_verified" : "no_go_fix_quant_frozen_snapshot",
  checkedAt: new Date().toISOString(),
  configPath,
  snapshotPath: freeze.outputPath,
  manifestPath: freeze.manifestPath,
  snapshotId: snapshot.snapshotId,
  dataHash: snapshot.dataHash,
  snapshotHash: snapshot.snapshotHash,
  snapshotFileHash,
  sourceIdentity: snapshot.sourceIdentity,
  sourceClassification: snapshot.sourceClassification,
  rows: snapshot.bars.length,
  dateRange: snapshot.dateRange,
  authority: snapshot.authority,
  checks,
  blockers,
  safety: {
    sendsLiveNetworkRequests: false,
    writesProductionDatabase: false,
    enablesTrading: false,
    initializesBrokerGateway: false,
    mutatesOfficialPortfolio: false,
    mutatesOfficialReview: false
  }
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);

async function runFreeze() {
  const result = await execFileAsync(process.execPath, ["scripts/quant-freeze-snapshot.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      QUANT_FREEZE_CONFIG: configPath
    },
    maxBuffer: 40 * 1024 * 1024
  });
  return JSON.parse(result.stdout);
}

function computeDataHash(snapshot) {
  return sha256(stableJson({
    schemaVersion: "2026-06-20.quant-snapshot.v1",
    sourceKind: snapshot.source,
    sourcePath: snapshot.sourcePath,
    sourceHash: snapshot.sourceHash,
    adjustment: snapshot.adjustment,
    dataCutoff: snapshot.dataCutoff,
    ...(snapshot.hkConnectUniverse ? { hkConnectUniverse: snapshot.hkConnectUniverse } : {}),
    universe: snapshot.universe,
    dateRange: snapshot.dateRange,
    bars: snapshot.bars.map((bar) => ({
      market: bar.market,
      code: bar.code,
      tradeDate: bar.tradeDate,
      open: Number(bar.open),
      high: Number(bar.high),
      low: Number(bar.low),
      close: Number(bar.close),
      volume: Number(bar.volume),
      turnover: Number(bar.turnover),
      adjustment: bar.adjustment,
      source: bar.source,
      fetchedAt: bar.fetchedAt
    })).sort((a, b) => `${a.market}.${a.code}.${a.tradeDate}`.localeCompare(`${b.market}.${b.code}.${b.tradeDate}`))
  }));
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

function buildSnapshotId(snapshot, dataHash) {
  const universeKey = snapshot.universe.map((item) => `${item.market}.${item.code}`).join("-");
  return [
    String(snapshot.universe[0]?.market ?? "hk").toLowerCase(),
    universeKey.replace(/[^A-Za-z0-9.-]+/g, "-").toLowerCase(),
    snapshot.adjustment,
    snapshot.dateRange.start,
    snapshot.dateRange.end,
    dataHash.slice(0, 12)
  ].join("-");
}

function isValidSourceIdentity(identity, snapshot) {
  if (!identity || typeof identity !== "object") return false;
  if (identity.source !== snapshot.source || identity.sourceKind !== snapshot.source) return false;
  if (identity.sourcePath !== snapshot.sourcePath || identity.sourceHash !== snapshot.sourceHash) return false;
  if (identity.authority !== "research_only") return false;
  if (identity.classification === "approved_real_historical") {
    if (!nonPlaceholder(identity.provenance) || !nonPlaceholder(identity.authorizationId) || identity.externalFetch !== true) return false;
  } else {
    if (!["fixture", "fixture_market_data_export"].includes(identity.classification)) return false;
    if (identity.provenance !== "repository_local_fixture" || identity.externalFetch !== false) return false;
  }
  if (!Number.isFinite(Date.parse(identity.asOf))) return false;
  if (!Number.isFinite(Date.parse(identity.fetchedAt))) return false;
  return true;
}

function isApprovedSourceLocation(snapshot) {
  if (snapshot.sourceClassification === "approved_real_historical") {
    return String(snapshot.sourcePath).startsWith("data/quant-approved/") && snapshot.sourceIdentity.externalFetch === true;
  }
  return String(snapshot.sourcePath).startsWith("data/quant-fixtures/")
    && ["fixture", "fixture_market_data_export"].includes(snapshot.sourceClassification)
    && snapshot.sourceIdentity.externalFetch === false;
}

function nonPlaceholder(value) {
  return typeof value === "string" && value.trim().length > 0 && !/^(unknown|missing|none|n\/?a|unavailable|placeholder|example|fixture|synthetic)$/i.test(value.trim());
}

function isResearchOnlyAuthority(authority) {
  return authority?.type === "research_only"
    && authority.advisoryOnly === true
    && authority.officialPortfolioFact === false
    && authority.officialReviewFact === false
    && authority.ranking === false
    && authority.recommendation === false
    && authority.score === false
    && authority.allocation === false
    && authority.sizing === false
    && authority.targetPrice === false
    && authority.buySellHold === false
    && authority.orderTradeFill === false
    && authority.cashFeePositionMutation === false
    && authority.brokerWrite === false
    && authority.productionWrite === false;
}

function isNoWriteSafety(safety) {
  return safety?.sendsLiveNetworkRequests === false
    && safety.writesProductionDatabase === false
    && safety.enablesTrading === false
    && safety.initializesBrokerGateway === false
    && safety.mutatesOfficialPortfolio === false
    && safety.mutatesOfficialReview === false;
}

function check(id, ok, evidence) {
  checks.push({ id, ok: Boolean(ok), evidence });
}

async function readText(path) {
  return readFile(resolvePath(path), "utf8");
}

function resolvePath(path) {
  return String(path).startsWith("/") ? String(path) : join(root, String(path));
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
