import { makeFactMetadata } from "../../../../packages/contracts/src/factMetadata.js";
import { areInstantsChronologicallyOrdered } from "../../../../packages/contracts/src/chronology.js";
import type { DecisionContextEnvelope } from "../../../../packages/contracts/src/decisionContext.js";
import { loadQuantEvidenceManifestForSymbol } from "./quantEvidenceManifest.js";
import {
  hkConnectQuantUniverseMatches,
  type DecisionQuantEvidenceOptions
} from "./quantEvidenceSource.js";
import {
  quantDecisionEvidenceRefinementFromManifest,
  quantDecisionEvidenceUnavailable
} from "./quantDecisionEvidenceRefinement.js";
import { latestIso } from "./decisionContextMappers.js";
import type { CandidateDiscoveryUniverse } from "../../../../packages/contracts/src/marketDiscovery.js";

type QuantEvidence = DecisionContextEnvelope["quantEvidence"];
type FailStatus = Exclude<QuantEvidence["status"], "available">;
type Failure = { ok: false; status: FailStatus; reason: string; message: string };
type Facts = {
  dataIdentity: Record<string, unknown>;
  sourceIdentity: Record<string, unknown>;
  universe: string[];
  splitIds: string[];
  limitations: string[];
  shadowPortfolio: Record<string, unknown>;
  decisionEvidence: QuantEvidence["decisionEvidence"];
  comparison: QuantEvidence["comparison"];
  hkConnectUniverse?: CandidateDiscoveryUniverse;
};

export async function readDecisionQuantEvidence(
  requestedSymbol: string,
  now: Date,
  options: DecisionQuantEvidenceOptions
): Promise<QuantEvidence> {
  if (!Number.isFinite(options.maxAgeDays) || options.maxAgeDays < 0) {
    return fail("malformed", "malformed:invalid-freshness-policy", "Quant research evidence freshness policy must be an explicit non-negative finite number of days.");
  }
  const loaded = await loadQuantEvidenceManifestForSymbol(options.address, options.source, requestedSymbol);
  if (!loaded.ok) {
    const messages = {
      missing: "Quant research evidence is missing because the local shadow-portfolio manifest has not been generated.",
      unauthorized: "Quant research evidence manifest cannot be read by the current process and is not used.",
      malformed: "Quant research evidence manifest is malformed and is not used.",
      unavailable: "Quant research evidence manifest cannot be read and is not used."
    } as const;
    return fail(
      loaded.status,
      `${loaded.status}:${loaded.reason}`,
      loaded.reason.startsWith("fee-policy:") || loaded.reason.startsWith("dividend-cash-policy:")
        ? loaded.reason.slice(loaded.reason.indexOf(":") + 1)
        : messages[loaded.status]
    );
  }
  const manifest = loaded.manifest;
  if (!record(manifest) || manifest.ok !== true) {
    return fail("unavailable", "unavailable:manifest-not-ok", "Quant research evidence manifest is unavailable or did not pass its own checks.");
  }
  const checked = validateManifest(manifest, requestedSymbol, now, options.maxAgeDays, options);
  if (!checked.ok) return fail(checked.status, checked.reason, checked.message);
  const { dataIdentity, sourceIdentity, universe, splitIds, limitations, shadowPortfolio, decisionEvidence, comparison, hkConnectUniverse } = checked;
  return {
    status: "available",
    metadata: makeFactMetadata({
      source: loaded.catalogContentHash
        ? `decision_context.quant:catalog-sha256:${loaded.catalogContentHash}:manifest-sha256:${loaded.contentHash}`
        : `decision_context.quant:sha256:${loaded.contentHash}`,
      asOf: stringOrNull(sourceIdentity.asOf), fetchedAt: stringOrNull(sourceIdentity.fetchedAt),
      freshness: "historical", provenance: "quant_evidence", authority: "quant_evidence",
      stale: false, missing: false, conflict: false, fixture: dataIdentity.sourceClassification === "fixture",
      correctionOf: null, replaces: null,
      message: "Quant research evidence is bound to the accepted frozen snapshot, baseline experiment, and isolated shadow portfolio identities."
    }),
    identities: {
      frozenSnapshot: {
        snapshotId: String(dataIdentity.snapshotId), snapshotHash: String(dataIdentity.snapshotHash), dataHash: String(dataIdentity.dataHash),
        sourceClassification: sourceClassification(dataIdentity.sourceClassification)
      },
      baselineExperimentIdentity: String(manifest.experimentIdentity), splitIds,
      shadowPortfolioIdentity: String(manifest.shadowPortfolioIdentity),
      shadowPortfolioId: String(shadowPortfolio.shadowPortfolioId), generatedAt: String(manifest.generatedAt),
      ...(hkConnectUniverse ? { hkConnectUniverse } : {})
    },
    sampleBoundary: {
      universe, sourceClassification: sourceClassification(dataIdentity.sourceClassification),
      finalTestPolicy: "locked_report_only_no_tuning",
      limitation: `${sampleBoundaryScope(dataIdentity.sourceClassification)}; final-test rows are report-only and cannot tune parameters or thresholds, and recomputing a frozen sample never refreshes its source dates into current market validity.`
    },
    limitations,
    authority: safeAuthority(),
    decisionEvidence,
    ...(comparison ? { comparison } : {}),
    message: "Quant evidence is read-only research context; it does not rank candidates, alter reviews, or create portfolio, broker, cash, fee, position, order, trade, or fill authority."
  };
}

function validateManifest(manifest: Record<string, unknown>, requestedSymbol: string, now: Date, maxAgeDays: number, options: DecisionQuantEvidenceOptions): ({ ok: true } & Facts) | Failure {
  const dataIdentity = at(manifest, "dataIdentity");
  const shadowPortfolio = at(manifest, "shadowPortfolio");
  const sourceIdentity = at(dataIdentity, "sourceIdentity");
  if (!dataIdentity || !shadowPortfolio || !sourceIdentity) return malformed("missing-identity", "Quant research evidence manifest is missing required data, source, or shadow-portfolio identity.");
  if (!authorityIsSafe(at(shadowPortfolio, "authority"))) return conflict("unsafe-authority", "Quant research evidence manifest authority conflicts with advisory-only boundaries and is hidden.");
  const required: Array<[Record<string, unknown>, string, string]> = [
    [dataIdentity, "snapshotId", "dataIdentity.snapshotId"], [dataIdentity, "snapshotHash", "dataIdentity.snapshotHash"], [dataIdentity, "dataHash", "dataIdentity.dataHash"],
    [dataIdentity, "dataCutoff", "dataIdentity.dataCutoff"],
    [manifest, "experimentIdentity", "experimentIdentity"], [manifest, "shadowPortfolioIdentity", "shadowPortfolioIdentity"], [manifest, "generatedAt", "generatedAt"],
    [shadowPortfolio, "shadowPortfolioId", "shadowPortfolio.shadowPortfolioId"], [shadowPortfolio, "shadowPortfolioIdentity", "shadowPortfolio.shadowPortfolioIdentity"],
    [shadowPortfolio, "experimentIdentity", "shadowPortfolio.experimentIdentity"]
  ];
  for (const [owner, key, label] of required) if (!requiredString(owner[key])) return malformed("missing-identity-field", `Quant research evidence manifest is missing ${label}; no synthetic identity is exposed.`);
  if (!sha(dataIdentity.snapshotHash) || !sha(dataIdentity.dataHash)) return malformed("invalid-hash", "Quant research evidence manifest has an invalid snapshot or data hash.");
  if (!dateTime(manifest.generatedAt)) return malformed("invalid-generated-at", "Quant research evidence manifest generatedAt is invalid.");
  if (!dateTime(dataIdentity.dataCutoff)) return malformed("invalid-data-cutoff", "Quant research evidence manifest data cutoff is invalid.");
  if (!validSourceClassification(dataIdentity.sourceClassification)) return malformed("invalid-source-classification", "Quant research evidence manifest source classification is invalid.");
  if (sourceIdentity.authority !== "research_only" || !dateTime(sourceIdentity.asOf) || !dateTime(sourceIdentity.fetchedAt)) return malformed("invalid-source-identity", "Quant research evidence manifest source identity must be research-only with valid as-of and fetched-at timestamps.");
  if (!areInstantsChronologicallyOrdered([
    sourceIdentity.asOf, dataIdentity.dataCutoff, sourceIdentity.fetchedAt, manifest.generatedAt, now
  ])) return conflict("source-chronology", "Quant research evidence must satisfy asOf <= dataCutoff <= fetchedAt <= generatedAt <= evaluatedAt; future or reversed evidence is hidden.");
  const frozen = at(shadowPortfolio, "frozenSnapshotIdentity");
  if (!frozen) return malformed("missing-frozen-snapshot-identity", "Quant research evidence manifest is missing frozen snapshot identity binding.");
  for (const field of ["snapshotId", "snapshotHash", "dataHash"] as const) if (frozen[field] !== dataIdentity[field]) return conflict("frozen-snapshot-identity-mismatch", "Quant research evidence manifest data identity conflicts with its shadow-portfolio frozen snapshot identity.");
  if (shadowPortfolio.shadowPortfolioIdentity !== manifest.shadowPortfolioIdentity || shadowPortfolio.experimentIdentity !== manifest.experimentIdentity) return conflict("shadow-portfolio-identity-mismatch", "Quant research evidence manifest shadow-portfolio identity conflicts with its top-level identity.");
  const splitRegistry = at(manifest, "splitRegistry");
  const splits = Array.isArray(splitRegistry?.splits) ? splitRegistry.splits.filter(record) : [];
  const splitIds = splits.map((split) => String(split.id ?? "")).filter(Boolean);
  const shadowSplitIds = Array.isArray(shadowPortfolio.splitIds) ? shadowPortfolio.splitIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0) : [];
  if (!splitIds.length || !shadowSplitIds.length) return malformed("missing-split-identity", "Quant research evidence manifest is missing sample-split identities.");
  if (splitIds.join("|") !== shadowSplitIds.join("|")) return conflict("split-identity-mismatch", "Quant research evidence manifest split identities conflict with the shadow portfolio.");
  const finalTest = splits.find((split) => split.id === "final_test");
  if (!finalTest || finalTest.parameterSelectionAllowed !== false || finalTest.finalTestLocked !== true) return malformed("final-test-policy", "Quant research evidence manifest must bind a locked final-test split that is report-only and not used for tuning.");
  const universe = Array.isArray(dataIdentity.universe) ? dataIdentity.universe.filter(record).map((item) => `${String(item.market)}.${String(item.code)}`).filter((symbol) => /^HK\.[0-9]{5}$/.test(symbol)) : [];
  if (!universe.length) return malformed("missing-universe", "Quant research evidence manifest has no canonical Hong Kong universe.");
  if (!universe.includes(requestedSymbol)) return { ok: false, status: "missing", reason: "missing:symbol-not-in-quant-universe", message: `Quant research evidence is not available for ${requestedSymbol}; no quant facts are synthesized from another symbol.` };
  const expectedUniverse = options?.hkConnectUniverse;
  const hkConnectUniverse = validateHkConnectUniverse(dataIdentity, universe, expectedUniverse);
  if (!hkConnectUniverse.ok) return hkConnectUniverse;
  const refinement = quantDecisionEvidenceRefinementFromManifest(manifest, requestedSymbol);
  if (!refinement.ok) return { ok: false, status: refinement.status, reason: `${refinement.status}:${refinement.reason}`, message: refinement.message };
  const stale = staleReason(sourceIdentity, now, maxAgeDays);
  // An explicitly historical frozen sample keeps its original source dates and stays readable as
  // history: recomputation never makes that source current, so it is labelled instead of hidden.
  const sourceAge = sourceAgePolicy(dataIdentity, sourceIdentity, stale, maxAgeDays);
  if (sourceAge.failure) return { ok: false, status: "stale", reason: "stale:source-older-than-policy", message: `Quant research evidence is stale under the configured local max-age policy: ${stale}.` };
  const limitations = [...new Set([
    ...(Array.isArray(shadowPortfolio.limitations)
      ? shadowPortfolio.limitations.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : ["Quant evidence is repository-local research context only."]),
    ...refinement.presentationLimitations,
    ...sourceAge.limitations
  ])];
  return { ok: true, dataIdentity, sourceIdentity, universe, splitIds, limitations, shadowPortfolio,
    decisionEvidence: refinement.value, comparison: refinement.comparison,
    ...(hkConnectUniverse.binding ? { hkConnectUniverse: hkConnectUniverse.binding } : {}) };
}

function validateHkConnectUniverse(
  dataIdentity: Record<string, unknown>,
  universe: string[],
  expected: DecisionQuantEvidenceOptions["hkConnectUniverse"]
): { ok: true; binding?: CandidateDiscoveryUniverse } | Failure {
  if (!expected) return { ok: true };
  const actual = at(dataIdentity, "hkConnectUniverse");
  if (!actual || !hkConnectQuantUniverseMatches(actual, expected)) {
    return conflict("hk-connect-universe-mismatch", "Quant research evidence is not bound to the current official Hong Kong Connect universe snapshot.");
  }
  if (universe.some((symbol) => !expected.members.has(symbol))) {
    return conflict("symbol-outside-hk-connect-universe", "Quant research evidence contains a symbol outside the bound official Hong Kong Connect universe.");
  }
  return { ok: true, binding: expected.binding };
}

function fail(status: FailStatus, reason: string, message: string): QuantEvidence {
  const freshness = status === "missing" ? "missing" : status === "stale" ? "stale" : status === "conflict" ? "conflict" : "unavailable";
  return { status, metadata: makeFactMetadata({ source: `decision_context.quant:${reason}`, asOf: null, fetchedAt: null, freshness, provenance: "quant_evidence", authority: "quant_evidence", stale: status === "stale", missing: status === "missing", conflict: status === "conflict", fixture: false, correctionOf: null, replaces: null, message }), identities: null, sampleBoundary: { universe: [], sourceClassification: "unavailable", finalTestPolicy: "unavailable", limitation: "Quant evidence is fail-closed and no other symbol, fixture, or prior artifact is reused." }, limitations: [message], authority: safeAuthority(), decisionEvidence: quantDecisionEvidenceUnavailable(message), message };
}

function safeAuthority(): QuantEvidence["authority"] {
  return { researchOnly: true, advisoryOnly: true, changesCandidateOrdering: false, changesMembershipState: false, changesHumanReviewResult: false, mutatesLocalRecord: false, officialReviewFact: false, officialPortfolioFact: false, brokerWrite: false, recommendation: false, ranking: false, score: false, allocation: false, sizing: false, targetPrice: false, buySellHold: false, orderTradeFillAuthority: false, cashFeePositionMutation: false };
}

function authorityIsSafe(value: Record<string, unknown> | null): boolean {
  return !!value && value.advisoryOnly === true && value.simulationOnly === true && ["brokerReconciliation", "accountTruth", "accountingAuthority", "ranking", "recommendation", "score", "allocation", "sizing", "targetPrice", "buySellHold", "orderInstruction", "tradeInstruction", "orderTradeFillAuthority", "cashFeePositionMutation", "brokerWrite", "productionWrite", "officialPortfolioFact", "officialReviewFact"].every((field) => value[field] === false);
}
export function decisionQuantEvidenceConfigurationUnavailable(): QuantEvidence {
  return fail("unavailable", "unavailable:explicit-configuration-required", "Quant research evidence is unavailable until its repository root, relative path, content hash, source adapter, and freshness policy are explicitly injected.");
}
function staleReason(source: Record<string, unknown>, now: Date, maxAgeDays: number): string | null { const freshest = latestIso([String(source.asOf), String(source.fetchedAt)]); if (!freshest) return "missing source timestamp"; return now.getTime() - Date.parse(freshest) > maxAgeDays * 86400000 ? `freshest source timestamp ${freshest} exceeds ${maxAgeDays} day(s)` : null; }
function historicalSourceAgeLimitation(source: Record<string, unknown>, dataIdentity: Record<string, unknown>, stale: string, maxAgeDays: number): string {
  return `冻结历史样本（sourceClassification=historical，来源数据截止 ${String(dataIdentity.dataCutoff)}）：${stale}，配置时效上限 ${maxAgeDays} 天；该证据仅作为历史样本研究参考，不代表当前市场有效性，重新计算不会刷新来源数据。`;
}
/** Age policy outcome: an explicit historical source is labelled and kept readable instead of hidden. */
function sourceAgePolicy(dataIdentity: Record<string, unknown>, source: Record<string, unknown>, stale: string | null, maxAgeDays: number): { failure: boolean; limitations: string[] } {
  if (!stale) return { failure: false, limitations: [] };
  if (dataIdentity.sourceClassification !== "historical") return { failure: true, limitations: [] };
  return { failure: false, limitations: [historicalSourceAgeLimitation(source, dataIdentity, stale, maxAgeDays)] };
}
function sampleBoundaryScope(classification: unknown): string {
  if (classification === "historical") return "Repository-local quant evidence is a frozen historical sample bound to its original as-of, fetched-at and data-cutoff dates";
  if (classification === "real") return "Repository-local quant evidence is a bound real-source research snapshot";
  if (classification === "research_only") return "Repository-local quant evidence is research-only repository context";
  return "Repository-local quant evidence is fixture-bound research context only";
}
function malformed(reason: string, message: string): Failure { return { ok: false, status: "malformed", reason: `malformed:${reason}`, message }; }
function conflict(reason: string, message: string): Failure { return { ok: false, status: "conflict", reason: `conflict:${reason}`, message }; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function at(value: unknown, key: string): Record<string, unknown> | null { return record(value) && record(value[key]) ? value[key] : null; }
function requiredString(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value !== "undefined" && value !== "null"; }
function stringOrNull(value: unknown): string | null { return requiredString(value) ? value : null; }
function sha(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{32,128}$/i.test(value); }
function dateTime(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function validSourceClassification(value: unknown): boolean { return value === "fixture" || value === "real" || value === "historical" || value === "research_only"; }
function sourceClassification(value: unknown): "fixture" | "real" | "historical" | "research_only" { return value === "real" || value === "historical" || value === "research_only" ? value : "fixture"; }
