import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

export const HK_CONNECT_SOURCE_URLS = [
  "https://www.sse.com.cn/services/hkexsc/disclo/eligible/",
  "https://www.szse.cn/szhk/hkbussiness/underlylist/"
];

export async function loadHkConnectUniverse(path) {
  const manifestPath = resolvePath(path);
  const text = await readFile(manifestPath, "utf8");
  const value = JSON.parse(text);
  if (value?.schemaVersion !== "2026-08-16.hk-connect-southbound-universe.v1"
    || !/^[a-f0-9]{64}$/.test(String(value.snapshotId))
    || !/^\d{4}-\d{2}-\d{2}$/.test(String(value.effectiveDate))
    || !isStrictIsoInstant(value.capturedAt)
    || !Array.isArray(value.members) || value.members.length < 2
    || !Array.isArray(value.sources) || value.sources.length !== 2
    || JSON.stringify(value.sources.map((source) => source.pageUrl)) !== JSON.stringify(HK_CONNECT_SOURCE_URLS)) {
    throw new Error("Hong Kong Connect universe manifest is malformed");
  }
  const normalized = { schemaVersion: value.schemaVersion, effectiveDate: value.effectiveDate, sources: value.sources, members: value.members };
  if (sha256(JSON.stringify(normalized)) !== value.snapshotId) throw new Error("Hong Kong Connect universe snapshot hash is invalid");
  const historyPath = join(dirname(manifestPath), `${basename(manifestPath, ".json")}.history`, `${value.effectiveDate}-${value.snapshotId}.json`);
  if (await readFile(historyPath, "utf8") !== text) throw new Error("Hong Kong Connect universe immutable history is missing or changed");
  const symbols = value.members.map((item) => item.symbol);
  if (new Set(symbols).size !== symbols.length || symbols.some((symbol) => !/^HK\.\d{5}$/.test(symbol))) {
    throw new Error("Hong Kong Connect universe members are invalid");
  }
  return {
    binding: {
      source: "hkex_sse_szse_southbound_official",
      snapshotId: value.snapshotId,
      effectiveDate: value.effectiveDate,
      capturedAt: value.capturedAt,
      memberCount: symbols.length,
      sourceUrls: HK_CONNECT_SOURCE_URLS
    },
    members: new Set(symbols)
  };
}

export function frozenSnapshotMatchesHkConnectUniverse(official, snapshot, manifest) {
  return JSON.stringify(snapshot.hkConnectUniverse) === JSON.stringify(official.binding)
    && JSON.stringify(manifest.hkConnectUniverse) === JSON.stringify(official.binding)
    && JSON.stringify(snapshot.universe) === JSON.stringify(manifest.universe)
    && snapshot.universe.every((item) => official.members.has(item.symbol));
}

function resolvePath(path) {
  return String(path).startsWith("/") ? String(path) : join(root, String(path));
}

function isStrictIsoInstant(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(String(value))) return false;
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
