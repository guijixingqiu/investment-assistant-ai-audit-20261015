import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  CandidateDiscoveryUniverse,
  MarketDiscoveryEligibility
} from "../../../../packages/contracts/src/marketDiscovery.js";

export const HK_CONNECT_UNIVERSE_PATH = "config/hk-connect-universe.southbound.json";
export const HK_CONNECT_UNIVERSE_SCHEMA_VERSION = "2026-08-16.hk-connect-southbound-universe.v1";

const SOURCE_PAGES = {
  shanghai: "https://www.sse.com.cn/services/hkexsc/disclo/eligible/",
  shenzhen: "https://www.szse.cn/szhk/hkbussiness/underlylist/"
} as const;

export interface HkConnectUniverse {
  binding: CandidateDiscoveryUniverse;
  members: ReadonlySet<string>;
}

export function classifyHkConnectEligibility(universe: HkConnectUniverse, symbol: string): MarketDiscoveryEligibility {
  const eligible = universe.members.has(symbol);
  return {
    requestedSymbol: symbol,
    status: eligible ? "eligible" : "not_eligible",
    universe: universe.binding,
    message: eligible
      ? `${symbol} belongs to the official Hong Kong Connect snapshot dated ${universe.binding.effectiveDate}.`
      : `${symbol} is outside the official Hong Kong Connect snapshot dated ${universe.binding.effectiveDate}; manual Research remains available without candidate discovery or ranking.`
  };
}

export function loadHkConnectUniverse(repositoryRoot: string): HkConnectUniverse {
  const currentPath = resolve(repositoryRoot, HK_CONNECT_UNIVERSE_PATH);
  const currentText = readFileSync(currentPath, "utf8");
  const value = JSON.parse(currentText) as unknown;
  if (!record(value) || value.schemaVersion !== HK_CONNECT_UNIVERSE_SCHEMA_VERSION
    || typeof value.snapshotId !== "string" || !/^[a-f0-9]{64}$/.test(value.snapshotId)
    || typeof value.capturedAt !== "string" || !Number.isFinite(Date.parse(value.capturedAt))
    || typeof value.effectiveDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.effectiveDate)
    || !Array.isArray(value.sources) || value.sources.length !== 2
    || !Array.isArray(value.members) || value.members.length < 2 || value.members.length > 5_000) {
    throw new Error("Hong Kong Connect universe manifest is malformed");
  }
  const sources = value.sources.map((source) => {
    if (!record(source) || !new Set(["shanghai", "shenzhen"]).has(String(source.channel))
      || source.pageUrl !== SOURCE_PAGES[source.channel as keyof typeof SOURCE_PAGES]
      || typeof source.dataUrl !== "string" || !safeOfficialUrl(source.dataUrl)
      || source.effectiveDate !== value.effectiveDate
      || typeof source.normalizedSha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.normalizedSha256)
      || !Number.isSafeInteger(source.eligibleSecurityCount) || Number(source.eligibleSecurityCount) < 2) {
      throw new Error("Hong Kong Connect universe source is malformed");
    }
    return {
      channel: source.channel,
      pageUrl: source.pageUrl,
      dataUrl: source.dataUrl,
      effectiveDate: source.effectiveDate,
      normalizedSha256: source.normalizedSha256,
      eligibleSecurityCount: source.eligibleSecurityCount
    };
  });
  if (new Set(sources.map((source) => source.channel)).size !== 2) throw new Error("Hong Kong Connect universe sources are duplicated");
  const members = value.members.map((member) => {
    if (!record(member) || typeof member.symbol !== "string" || !/^HK\.\d{5}$/.test(member.symbol)
      || member.code !== member.symbol.slice(3)
      || typeof member.nameZh !== "string" || typeof member.nameEn !== "string"
      || member.nameZh.trim().length === 0 && member.nameEn.trim().length === 0
      || !Array.isArray(member.channels) || member.channels.join(",") !== "shanghai,shenzhen") {
      throw new Error("Hong Kong Connect universe member is malformed");
    }
    return {
      symbol: member.symbol,
      code: member.code,
      nameZh: member.nameZh,
      nameEn: member.nameEn,
      channels: member.channels
    };
  });
  const symbols = members.map((member) => member.symbol);
  if (new Set(symbols).size !== symbols.length || !symbols.includes("HK.00175") || !symbols.includes("HK.00700")) {
    throw new Error("Hong Kong Connect universe identities are invalid");
  }
  const normalized = {
    schemaVersion: value.schemaVersion,
    effectiveDate: value.effectiveDate,
    sources,
    members
  };
  const snapshotId = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  if (snapshotId !== value.snapshotId) throw new Error("Hong Kong Connect universe snapshot hash is invalid");
  const historyPath = resolve(
    repositoryRoot,
    "config/hk-connect-universe.southbound.history",
    `${value.effectiveDate}-${snapshotId}.json`
  );
  if (readFileSync(historyPath, "utf8") !== currentText) {
    throw new Error("Hong Kong Connect universe immutable history does not match current snapshot");
  }
  return {
    binding: {
      source: "hkex_sse_szse_southbound_official",
      snapshotId,
      effectiveDate: value.effectiveDate,
      capturedAt: value.capturedAt,
      memberCount: members.length,
      sourceUrls: [SOURCE_PAGES.shanghai, SOURCE_PAGES.shenzhen]
    },
    members: new Set(symbols)
  };
}

function safeOfficialUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && new Set(["query.sse.com.cn", "www.szse.cn"]).has(url.hostname)
      && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
