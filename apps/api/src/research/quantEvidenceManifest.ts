import type { QuantEvidenceAddress, QuantEvidenceSource } from "./quantEvidenceSource.js";
import { quantManifestDividendCashGate, quantManifestFeePolicyGate } from "../../../../packages/contracts/src/quantRegisteredResearchRun.js";

export type QuantEvidenceManifestLoadResult =
  | { ok: true; manifest: unknown; path: string; contentHash: string; catalogContentHash?: string }
  | { ok: false; status: "missing" | "unauthorized" | "malformed" | "unavailable"; reason: string; path: string | null };

export async function loadQuantEvidenceManifest(
  address: QuantEvidenceAddress,
  source: QuantEvidenceSource
): Promise<QuantEvidenceManifestLoadResult> {
  const loaded = await source.read(address);
  if (!loaded.ok) return loaded;

  try {
    return {
      ok: true,
      manifest: JSON.parse(loaded.content),
      path: loaded.path,
      contentHash: loaded.contentHash
    };
  } catch {
    return { ok: false, status: "malformed", reason: "manifest-json", path: loaded.path };
  }
}

export async function loadQuantEvidenceManifestForSymbol(
  address: QuantEvidenceAddress,
  source: QuantEvidenceSource,
  symbol: string
): Promise<QuantEvidenceManifestLoadResult> {
  const catalog = await loadQuantEvidenceManifest(address, source);
  if (!catalog.ok) return catalog;
  let selected = catalog;
  let catalogContentHash: string | undefined;
  if (isCatalog(catalog.manifest)) {
    const entries = validCatalogEntries(catalog.manifest);
    if (!entries) return { ok: false, status: "malformed", reason: "manifest-catalog", path: catalog.path };
    const entry = entries.find((item) => item.symbol === symbol);
    if (!entry) return { ok: false, status: "missing", reason: "catalog-symbol", path: catalog.path };
    const loaded = await loadQuantEvidenceManifest({
      repositoryRoot: address.repositoryRoot,
      repositoryPath: entry.repositoryPath,
      expectedSha256: entry.sha256
    }, source);
    if (!loaded.ok) return loaded;
    if (isCatalog(loaded.manifest)) return { ok: false, status: "malformed", reason: "nested-manifest-catalog", path: loaded.path };
    selected = loaded;
    catalogContentHash = catalog.contentHash;
  }
  const feePolicy = quantManifestFeePolicyGate(selected.manifest);
  if (!feePolicy.ok) return { ok: false, status: "malformed", reason: `fee-policy:${feePolicy.message}`, path: selected.path };
  const dividendCash = quantManifestDividendCashGate(selected.manifest);
  if (!dividendCash.ok) return { ok: false, status: "malformed", reason: `dividend-cash-policy:${dividendCash.message}`, path: selected.path };
  return catalogContentHash ? { ...selected, catalogContentHash } : selected;
}

function isCatalog(value: unknown): value is Record<string, unknown> {
  return record(value) && value.schemaVersion === "2026-08-17.quant-decision-evidence-catalog.v1";
}

function validCatalogEntries(value: Record<string, unknown>): Array<{ symbol: string; repositoryPath: string; sha256: string }> | null {
  if (Object.keys(value).sort().join("|") !== "entries|generatedAt|schemaVersion"
    || typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt))
    || !Array.isArray(value.entries) || value.entries.length > 1_000) return null;
  const entries = value.entries.filter(record);
  if (entries.length !== value.entries.length || entries.some((entry) => Object.keys(entry).sort().join("|") !== "repositoryPath|sha256|symbol"
    || typeof entry.symbol !== "string" || !/^HK\.\d{5}$/.test(entry.symbol)
    || typeof entry.repositoryPath !== "string" || !entry.repositoryPath
    || typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256))) return null;
  if (new Set(entries.map((entry) => entry.symbol)).size !== entries.length) return null;
  return entries as Array<{ symbol: string; repositoryPath: string; sha256: string }>;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
