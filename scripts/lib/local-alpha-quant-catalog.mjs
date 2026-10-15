import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, posix, relative, resolve, sep } from "node:path";

const CATALOG_SCHEMA = "2026-08-17.quant-decision-evidence-catalog.v1";
const SHA256 = /^[a-f0-9]{64}$/;
const MISSING_SHA256 = "0".repeat(64);

export function bindApiQuantEvidenceEnvironment(baseEnvironment, options) {
  const catalog = options.catalogRequired
    ? quantCatalogBindingForChild(options.repositoryRoot, options.catalogPath)
    : null;
  const acceptedSha256 = catalog?.expectedSha256 ?? options.fallbackSha256 ?? null;
  const acceptedPath = catalog ? options.catalogPath : options.fallbackPath ?? null;
  return {
    environment: {
      ...baseEnvironment,
      QUANT_EVIDENCE_REPOSITORY_ROOT: acceptedSha256 ? options.repositoryRoot : "",
      QUANT_RESEARCH_EVIDENCE_MANIFEST: acceptedSha256 ? acceptedPath : "",
      QUANT_RESEARCH_EVIDENCE_MANIFEST_SHA256: acceptedSha256 ?? "",
      QUANT_RESEARCH_EVIDENCE_MAX_AGE_DAYS: acceptedSha256 ? "30" : ""
    },
    issue: catalog?.issue ?? null
  };
}

/** Keep the API alive on a damaged catalog; its existing reader reports the quant failure. */
export function quantCatalogBindingForChild(repositoryRoot, repositoryPath) {
  try {
    return { expectedSha256: readPublishedQuantCatalog(repositoryRoot, repositoryPath), issue: null };
  } catch (error) {
    let expectedSha256 = MISSING_SHA256;
    try {
      expectedSha256 = sha256(readFileSync(resolve(repositoryRoot, repositoryPath)));
    } catch {
      // A non-existent catalog is read as missing by the API's quant source.
    }
    return {
      expectedSha256,
      issue: error instanceof Error ? error.message : "published registered quant catalog is unavailable"
    };
  }
}

/** Read the published catalog afresh immediately before each managed API spawn. */
export function readPublishedQuantCatalog(repositoryRoot, repositoryPath) {
  const root = realpathSync(repositoryRoot);
  if (typeof repositoryPath !== "string"
    || !repositoryPath.startsWith("artifacts/quant-registered-runs/")
    || posix.normalize(repositoryPath) !== repositoryPath
    || !isContained(root, resolve(root, repositoryPath))) {
    throw new Error("registered quant catalog path is outside its repository artifact directory");
  }
  let bytes;
  try {
    const catalogPath = realpathSync(resolve(root, repositoryPath));
    if (!isContained(root, catalogPath) || !statSync(catalogPath).isFile()) throw new Error("invalid catalog file");
    bytes = readFileSync(catalogPath);
  } catch {
    throw new Error("published registered quant catalog is missing or unreadable");
  }
  let catalog;
  try {
    catalog = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("published registered quant catalog is malformed JSON");
  }
  if (!plain(catalog) || Object.keys(catalog).sort().join("|") !== "entries|generatedAt|schemaVersion"
    || catalog.schemaVersion !== CATALOG_SCHEMA
    || typeof catalog.generatedAt !== "string" || !Number.isFinite(Date.parse(catalog.generatedAt))
    || !Array.isArray(catalog.entries) || catalog.entries.length > 1_000) {
    throw new Error("published registered quant catalog has an invalid schema");
  }
  const symbols = new Set();
  for (const entry of catalog.entries) {
    if (!plain(entry) || Object.keys(entry).sort().join("|") !== "repositoryPath|sha256|symbol"
      || typeof entry.symbol !== "string" || !/^HK\.\d{5}$/.test(entry.symbol)
      || symbols.has(entry.symbol) || typeof entry.repositoryPath !== "string"
      || typeof entry.sha256 !== "string" || !SHA256.test(entry.sha256)) {
      throw new Error("published registered quant catalog contains an invalid entry");
    }
    symbols.add(entry.symbol);
    const manifestPath = resolve(root, entry.repositoryPath);
    if (isAbsolute(entry.repositoryPath) || posix.normalize(entry.repositoryPath) !== entry.repositoryPath
      || !isContained(root, manifestPath)
      || !entry.repositoryPath.endsWith("/run_manifest.json")) {
      throw new Error(`published registered quant catalog has an invalid manifest path for ${entry.symbol}`);
    }
    let manifest;
    try {
      const manifestRealPath = realpathSync(manifestPath);
      if (!isContained(root, manifestRealPath) || !statSync(manifestRealPath).isFile()) throw new Error("invalid manifest file");
      manifest = readFileSync(manifestRealPath);
    } catch {
      throw new Error(`published registered quant manifest is missing or unreadable for ${entry.symbol}`);
    }
    if (sha256(manifest) !== entry.sha256) {
      throw new Error(`published registered quant manifest SHA-256 differs for ${entry.symbol}`);
    }
  }
  return sha256(bytes);
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isContained(root, candidate) {
  const part = relative(root, candidate);
  return part !== "" && part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
