import type {
  HkConnectQuantUniverse,
  QuantEvidenceAddress,
  QuantEvidenceSource
} from "./quantEvidenceSource.js";
import { loadQuantEvidenceManifest } from "./quantEvidenceManifest.js";
import { readDecisionQuantEvidence } from "./decisionQuantEvidenceAdapter.js";

/** Kept as a local literal so this verifier stays a leaf module without cycles. */
const QUANT_DECISION_EVIDENCE_CATALOG_SCHEMA_VERSION = "2026-08-17.quant-decision-evidence-catalog.v1";

/**
 * Mutable, in-process trusted reference for the accepted quant evidence catalog.
 *
 * The address object handed to the existing read/validation path is mutated in
 * place, so every existing consumer keeps using the verified manifest path and
 * content address without re-reading a global environment variable. On restart
 * the value is re-seeded from configuration (local-alpha-runtime computes the
 * configured hashes at startup).
 */
export interface QuantEvidenceTrustedReference {
  current(): QuantEvidenceAddress;
  publish(next: QuantEvidenceAddress): void;
}

export function createQuantEvidenceTrustedReference(address: QuantEvidenceAddress): QuantEvidenceTrustedReference {
  return {
    current: () => address,
    publish: (next) => {
      address.repositoryRoot = next.repositoryRoot;
      address.repositoryPath = next.repositoryPath;
      address.expectedSha256 = next.expectedSha256;
    }
  };
}

/**
 * Bounded validation context for one newly generated symbol. The catalog itself
 * may still contain older entries that are individually stale or unavailable.
 */
export interface QuantEvidenceCatalogValidation {
  symbol: string;
  maxAgeDays: number;
  now: Date;
  hkConnectUniverse?: HkConnectQuantUniverse;
}

/**
 * Verify a candidate catalog through the existing content-addressed read path
 * (two-level catalog -> manifest resolution) plus the full decision-evidence
 * validation for the newly generated symbol. Returns false when the persisted
 * artifact cannot be re-read, is not a catalog, or its new symbol does not pass
 * schema, identity, metrics, chronology, and policy checks.
 */
export async function verifyQuantEvidenceCatalog(
  source: QuantEvidenceSource,
  address: QuantEvidenceAddress,
  validation?: QuantEvidenceCatalogValidation
): Promise<{ ok: true; contentHash: string } | { ok: false; reason: string }> {
  const loaded = await loadQuantEvidenceManifest(address, source);
  if (!loaded.ok) return { ok: false, reason: `${loaded.status}:${loaded.reason}` };
  const document = loaded.manifest;
  if (typeof document !== "object" || document === null || Array.isArray(document)
    || (document as Record<string, unknown>).schemaVersion !== QUANT_DECISION_EVIDENCE_CATALOG_SCHEMA_VERSION
    || !Array.isArray((document as Record<string, unknown>).entries)) {
    return { ok: false, reason: "malformed:catalog-schema" };
  }
  if (!validation) return { ok: true, contentHash: loaded.contentHash };
  const evidence = await readDecisionQuantEvidence(validation.symbol, validation.now, {
    address,
    source,
    maxAgeDays: validation.maxAgeDays,
    ...(validation.hkConnectUniverse ? { hkConnectUniverse: validation.hkConnectUniverse } : {})
  });
  if (evidence.status !== "available") {
    return { ok: false, reason: `${evidence.status}:decision-evidence:${evidence.metadata.source}` };
  }
  return { ok: true, contentHash: loaded.contentHash };
}
