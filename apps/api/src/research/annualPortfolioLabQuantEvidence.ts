import {
  validateAnnualPortfolioLabQuantEvidence,
  type AnnualPortfolioLabQuantEvidence
} from "../../../../packages/contracts/src/annualPortfolioLab.js";
import { quantManifestFeePolicyGate } from "../../../../packages/contracts/src/quantRegisteredResearchRun.js";
import { areInstantsChronologicallyOrdered } from "../../../../packages/contracts/src/chronology.js";
import {
  hkConnectQuantUniverseMatches,
  type AnnualPortfolioLabQuantEvidenceOptions,
  type QuantEvidenceSource
} from "./quantEvidenceSource.js";

export type AnnualPortfolioLabQuantEvidenceLoadResult =
  | { ok: true; evidence: AnnualPortfolioLabQuantEvidence; contentHash: string }
  | { ok: false; status: "missing" | "malformed" | "unavailable"; reason: string };

export async function loadAnnualPortfolioLabQuantEvidence(
  options: AnnualPortfolioLabQuantEvidenceOptions,
  now: Date
): Promise<AnnualPortfolioLabQuantEvidenceLoadResult> {
  if (!Number.isFinite(options.maxAgeDays) || options.maxAgeDays < 0 || !Number.isFinite(now.getTime())) {
    return { ok: false, status: "malformed", reason: "quant portfolio lab freshness policy is invalid" };
  }
  const loaded = await options.source.read(options.address);
  if (!loaded.ok) return annualPortfolioLabSourceFailure(loaded);
  let value: unknown;
  try {
    value = JSON.parse(loaded.content);
  } catch {
    return { ok: false, status: "malformed", reason: "quant portfolio lab manifest is not valid JSON" };
  }
  const validation = validateAnnualPortfolioLabQuantEvidence(value);
  if (!validation.ok) {
    return { ok: false, status: "malformed", reason: `quant portfolio lab evidence is invalid: ${validation.errors.join("; ")}` };
  }
  const feePolicy = quantManifestFeePolicyGate(value);
  if (!feePolicy.ok) {
    return { ok: false, status: "malformed", reason: feePolicy.message };
  }
  const hkConnectUniverse = options.hkConnectUniverse;
  if (hkConnectUniverse && (!hkConnectQuantUniverseMatches(validation.value.source.hkConnectUniverse, hkConnectUniverse)
    || validation.value.source.universe.some((item) => !hkConnectUniverse.members.has(`${item.market}.${item.code}`)))) {
    return { ok: false, status: "malformed", reason: "quant portfolio lab evidence is not bound to the current official Hong Kong Connect universe" };
  }
  const identity = validation.value.source.sourceIdentity;
  if (!areInstantsChronologicallyOrdered([
    identity.asOf,
    validation.value.source.dataCutoff,
    identity.fetchedAt,
    validation.value.generatedAt,
    now
  ])) {
    return { ok: false, status: "malformed", reason: "quant portfolio lab evidence has future or reversed source chronology" };
  }
  if (now.getTime() - Date.parse(identity.fetchedAt) > options.maxAgeDays * 86_400_000) {
    return {
      ok: false,
      status: "unavailable",
      reason: `quant portfolio lab evidence is stale: source fetchedAt ${identity.fetchedAt} exceeds ${options.maxAgeDays} day(s)`
    };
  }
  return { ok: true, evidence: validation.value, contentHash: loaded.contentHash };
}

export function annualPortfolioLabQuantEvidenceConfigurationUnavailable(): AnnualPortfolioLabQuantEvidenceLoadResult {
  return { ok: false, status: "unavailable", reason: "quant portfolio lab source is not explicitly configured" };
}

function annualPortfolioLabSourceFailure(
  failure: Exclude<Awaited<ReturnType<QuantEvidenceSource["read"]>>, { ok: true }>
): AnnualPortfolioLabQuantEvidenceLoadResult {
  if (failure.status === "missing") {
    return { ok: false, status: "missing", reason: "quant portfolio lab manifest is not generated" };
  }
  if (failure.status === "unauthorized" || failure.status === "unavailable") {
    return { ok: false, status: "unavailable", reason: "quant portfolio lab manifest cannot be read" };
  }
  const reasons: Record<string, string> = {
    "content-address-required": "quant portfolio lab content address is required",
    "content-address-mismatch": "quant portfolio lab content address does not match"
  };
  return {
    ok: false,
    status: "malformed",
    reason: reasons[failure.reason] ?? `quant portfolio lab source is invalid: ${failure.reason}`
  };
}
