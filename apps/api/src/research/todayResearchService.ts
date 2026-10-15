import type { QuantEvidenceRuntimeOptions } from "./quantEvidenceSource.js";
import type { Pool } from "pg";
import { canonicalJson } from "../../../../packages/contracts/src/decisionContextBrowser.js";
import { makeFactMetadata } from "../../../../packages/contracts/src/factMetadata.js";
import { DEEP_RESEARCH_OBJECTIVE_CHECK_IDS } from "../../../../packages/contracts/src/todayResearchQualityValidation.js";
import {
  buildTodayResearchItems,
  TODAY_RESEARCH_SCHEMA_VERSION,
  todayResearchSafety,
  type TodayResearchEnvelope,
  type TodayResearchQuality,
  type TodayResearchStatus
} from "../../../../packages/contracts/src/todayResearch.js";
import {
  deepResearchObjectiveChecks,
  evidencePackFingerprint,
  sha256
} from "./deepResearchGate.js";
import { readDeepResearchWorkspace } from "./deepResearchReadRepository.js";
import { validateCurrentHoldingBindings } from "./currentHoldingResearchBinding.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import { researchStockMaterials } from "../../../../packages/contracts/src/researchEvent.js";
import { readPendingWeinsteinStructureChange } from "../market/weinsteinTechnicalSnapshotRepository.js";

export interface TodayResearchReadOptions {
  quantEvidence?: QuantEvidenceRuntimeOptions | null;
  accountScopeId: string | null;
  currentPortfolioEnabled: boolean;
  currentPortfolioMaxAgeSeconds: number;
  sourceStore?:import("./researchSourceSnapshotRepository.js").SourceSnapshotStoreOptions;
}

export async function readTodayResearchEnvelope(
  pool: Pool,
  membershipId: string,
  actor: AuthenticatedResearchActor,
  options: TodayResearchReadOptions,
  now = new Date()
): Promise<TodayResearchEnvelope> {
  const workspace = await readDeepResearchWorkspace(pool, membershipId, actor, now, options);
  if (workspace.status !== "available" || !workspace.data || !workspace.requestedSymbol) {
    return todayResearchFailClosedEnvelope(
      now, membershipId, actor.actorId, workspace.status === "not_found" ? "not_found" : "unavailable", workspace.message
    );
  }
  const source = {
    membershipVersion: workspace.data.target.membershipVersion,
    requestedSymbol: workspace.requestedSymbol
  };
  const quality = buildTodayResearchQuality(workspace.data, now, workspace.metadata.stale);
  if (workspace.metadata.conflict) {
    return todayResearchFailClosedEnvelope(now, membershipId, actor.actorId, "conflict", workspace.metadata.message, { ...source, quality });
  }
  if (workspace.metadata.stale) {
    const fallback = buildFreshTodayEventFallback(workspace.data, now);
    if (fallback) {
      const generatedAt = now.toISOString();
      return {
        schemaVersion: TODAY_RESEARCH_SCHEMA_VERSION,
        generatedAt,
        status: "available",
        membershipId,
        membershipVersion: source.membershipVersion,
        requestedActorId: actor.actorId,
        requestedSymbol: source.requestedSymbol,
        metadata: metadata(generatedAt, "available", "Today exposes one current verified event while older research versions remain unavailable."),
        quality: fallback.quality,
        items: [fallback.item],
        omittedItemCount: fallback.omittedItemCount,
        message: "One current verified event needs review; older packs and reports remain historical.",
        safety: todayResearchSafety()
      };
    }
    return todayResearchFailClosedEnvelope(now, membershipId, actor.actorId, "stale", workspace.metadata.message, { ...source, quality });
  }
  const frozen = workspace.data.latestPack?.frozenResearchContext?.weinstein ?? null;
  const technicalChange = await readPendingWeinsteinStructureChange(pool, workspace.requestedSymbol, frozen);
  const built = buildTodayResearchItems(workspace.data, now, technicalChange);
  const holdingRefs = built.items.flatMap((item) => item.bindings.holdingSnapshotRefs);
  if (holdingRefs.length) {
    const holdingFailure = await validateCurrentHoldingBindings(
      pool, workspace.requestedSymbol, holdingRefs, options, now
    );
    if (holdingFailure) {
      return todayResearchFailClosedEnvelope(now, membershipId, actor.actorId, holdingFailure.status, holdingFailure.message, {
        ...source,
        quality: qualityWithHoldingFailure(quality, holdingFailure)
      });
    }
  }
  const generatedAt = now.toISOString();
  return {
    schemaVersion: TODAY_RESEARCH_SCHEMA_VERSION,
    generatedAt,
    status: "available",
    membershipId,
    membershipVersion: source.membershipVersion,
    requestedActorId: actor.actorId,
    requestedSymbol: source.requestedSymbol,
    metadata: metadata(generatedAt, "available", "Today exposes only current, version-bound material research changes and explicit user actions."),
    quality,
    items: built.items,
    omittedItemCount: built.omittedItemCount,
    message: `${built.items.length} bounded Today item(s) for ${source.requestedSymbol}; ${built.omittedItemCount} lower-priority item(s) omitted.`,
    safety: todayResearchSafety()
  };
}

type TodayWorkspaceData = NonNullable<Awaited<ReturnType<typeof readDeepResearchWorkspace>>["data"]>;

export function buildFreshTodayEventFallback(
  data: TodayWorkspaceData,
  now: Date
): { item: ReturnType<typeof buildTodayResearchItems>["items"][number]; quality: TodayResearchQuality; omittedItemCount: number } | null {
  const materials = new Map(data.materials.map((material) => [material.id, material]));
  const events = data.events.filter((event) => {
    const material = materials.get(event.source.materialId);
    return event.coverageScope === "research_stock"
      && event.importance !== "unknown"
      && ["supports", "weakens"].includes(event.hypothesisImpact)
      && event.source.freshness === "fresh"
      && event.source.revisionState === "current"
      && event.source.verificationStatus === "verified"
      && ["user_provided", "authorized_public"].includes(event.source.rightsStatus)
      && Date.parse(event.source.publishedAt) <= now.getTime()
      && Date.parse(event.source.capturedAt) <= now.getTime()
      && material?.contentFingerprint === event.source.contentFingerprint
      && material.sourceVersion === event.source.sourceVersion;
  }).sort((left, right) => Date.parse(right.source.publishedAt) - Date.parse(left.source.publishedAt)
    || Date.parse(right.source.capturedAt) - Date.parse(left.source.capturedAt)
    || right.eventVersion - left.eventVersion);
  const event = events[0];
  const material = event && materials.get(event.source.materialId);
  if (!event || !material) return null;
  const fallbackData: TodayWorkspaceData = {
    ...data,
    materials: [material],
    events: [event],
    latestGeelySalesMonitor: null,
    latestGclPvPriceMonitor: null,
    latestPack: null,
    evidencePacks: [],
    latestReport: null,
    reports: [],
    userDecision: null,
    decisions: [],
    completion: {
      state: "pack_required",
      deepResearchComplete: false,
      reasons: ["Review this current event before freezing deeper research evidence."]
    }
  };
  const item = buildTodayResearchItems(fallbackData, now).items.find(
    (candidate) => candidate.trackingState === "needs_review"
      && candidate.bindings.eventRefs.some((ref) => ref.eventId === event.id)
  );
  if (!item) return null;
  return {
    item: { ...item, order: 1 },
    quality: buildTodayResearchQuality(fallbackData, now),
    omittedItemCount: events.length - 1
  };
}

export function todayResearchFailClosedEnvelope(
  now: Date,
  membershipId: string,
  actorId: string,
  status: Exclude<TodayResearchStatus, "available"> | "not_found" | "unavailable",
  message: string,
  source?: { membershipVersion: number; requestedSymbol: string; quality: TodayResearchQuality }
): TodayResearchEnvelope {
  const generatedAt = now.toISOString();
  return {
    schemaVersion: TODAY_RESEARCH_SCHEMA_VERSION,
    generatedAt,
    status,
    membershipId,
    membershipVersion: status === "stale" || status === "conflict" ? source?.membershipVersion ?? null : null,
    requestedActorId: actorId,
    requestedSymbol: status === "stale" || status === "conflict" ? source?.requestedSymbol ?? null : null,
    metadata: metadata(generatedAt, status, message),
    quality: status === "stale" || status === "conflict" ? source?.quality ?? null : null,
    items: [],
    omittedItemCount: 0,
    message,
    safety: todayResearchSafety()
  };
}

export function buildTodayResearchQuality(
  data: NonNullable<Awaited<ReturnType<typeof readDeepResearchWorkspace>>["data"]>,
  now: Date,
  workspaceStale = false
): TodayResearchQuality {
  const stockMaterials = researchStockMaterials(data.materials, data.events);
  const current = stockMaterials.filter((item) => item.revisionState === "current");
  const pack = data.latestPack;
  const report = data.latestReport;
  const issueCodes: TodayResearchQuality["sourceHealth"]["issueCodes"] = [];
  if (current.length === 0) issueCodes.push("missing_materials");
  if (current.some((item) => item.freshness === "stale")) issueCodes.push("stale_materials");
  if (workspaceStale && !issueCodes.includes("stale_materials")) issueCodes.push("stale_materials");
  if (current.some((item) => item.verificationStatus === "conflict")) issueCodes.push("conflicting_materials");
  if (current.some((item) => item.verificationStatus !== "verified")) issueCodes.push("unverified_materials");
  if (current.some((item) => !["user_provided", "authorized_public"].includes(item.rightsStatus))) issueCodes.push("unauthorized_rights");
  if (current.some((item) => (item.publishedAt!==null && Date.parse(item.publishedAt) > now.getTime()) || Date.parse(item.capturedAt) > now.getTime())) issueCodes.push("future_source_time");
  const currentFingerprint = current.length
    ? evidencePackFingerprint(
      data.target.membershipId,
      data.target.membershipVersion,
      current,
      pack?.frozenResearchContext ?? undefined,
      pack?.researchMode
    )
    : null;
  if (current.length && (!pack || currentFingerprint !== pack.packFingerprint)) issueCodes.push("unfrozen_revision");
  if (pack && evidencePackFingerprint(
    pack.membershipId,
    pack.membershipVersion,
    pack.items,
    pack.frozenResearchContext === null ? undefined : pack.frozenResearchContext,
    pack.researchMode
  ) !== pack.packFingerprint) {
    issueCodes.push("pack_integrity_failure");
  }
  if (pack?.currentness.status === "historical") issueCodes.push("historical_evidence_pack");
  if (report && (!pack || report.evidencePackId !== pack.id)) issueCodes.push("report_pack_mismatch");
  const boundReport = report && pack?.currentness.status === "current"
    && report.evidencePackId === pack.id
    && report.currentness.status === "current"
    && report.currentness.invalidatedBy.length === 0
    && report.currentness.evidencePackInvalidatedBy.length === 0 ? report : null;
  const packRef = pack ? { id: pack.id, version: pack.version, packFingerprint: pack.packFingerprint } : null;
  const reportRef = boundReport ? {
    id: boundReport.id,
    version: boundReport.version,
    evidencePackId: boundReport.evidencePackId,
    status: boundReport.status
  } : null;
  const checks = boundReport && pack
    ? deepResearchObjectiveChecks(boundReport.payload, pack, now)
    : DEEP_RESEARCH_EMPTY_CHECKS;
  const gateFailures = [...new Set(checks.flatMap((check) => check.failures))];
  const sourceHealthStatus = todaySourceHealthStatus(issueCodes);
  const structurePassed = Boolean(boundReport && boundReport.status === "complete_pending_confirmation"
    && checks.every((check) => check.passed));
  const structureStatus = !boundReport ? "not_started" : structurePassed ? "passed" : "blocked";
  return {
    sourceHealth: {
      id: sha256(canonicalJson({
        membershipId: data.target.membershipId,
        membershipVersion: data.target.membershipVersion,
        sourceHealthStatus,
        issueCodes,
        totalMaterialCount: stockMaterials.length,
        materials: current.map((item) => ({
          id: item.id, evidenceId: item.evidenceId, revision: item.revision, sourceType: item.sourceType,
          sourceVersion: item.sourceVersion, contentFingerprint: item.contentFingerprint,
          publishedAt: item.publishedAt, capturedAt: item.capturedAt, validUntil: item.validUntil,
          verificationStatus: item.verificationStatus, rightsStatus: item.rightsStatus
        })),
        packRef,
        reportRef
      })),
      status: sourceHealthStatus,
      issueCodes,
      totalMaterialCount: stockMaterials.length,
      currentMaterialCount: current.length,
      evidencePackRef: packRef
    },
    researchStructure: {
      id: sha256(canonicalJson({
        membershipId: data.target.membershipId,
        membershipVersion: data.target.membershipVersion,
        packRef,
        reportRef,
        structureStatus,
        checks: checks.map(({ id, passed }) => ({ id, passed })),
        gateFailures
      })),
      status: structureStatus,
      checks: checks.map(({ id, passed }) => ({ id, passed })),
      gateFailures,
      reportRef
    },
    secondOpinion: {
      status: "not_evaluated",
      dependencyIncluded: false,
      reason: "No authorized multi-sample blinded evaluation has demonstrated stable additional counterevidence or error detection."
    }
  };
}

const DEEP_RESEARCH_EMPTY_CHECKS = DEEP_RESEARCH_OBJECTIVE_CHECK_IDS
  .map((id) => ({ id, passed: false, failures: [] })) as ReturnType<typeof deepResearchObjectiveChecks>;

function todaySourceHealthStatus(
  issueCodes: TodayResearchQuality["sourceHealth"]["issueCodes"]
): TodayResearchQuality["sourceHealth"]["status"] {
  if (issueCodes.includes("conflicting_materials")) return "conflict";
  if (issueCodes.includes("stale_materials")) return "stale";
  if (issueCodes.includes("unauthorized_rights")) return "rights_blocked";
  if (issueCodes.includes("unverified_materials") || issueCodes.includes("future_source_time")) return "verification_blocked";
  if (issueCodes.some((issue) => [
    "unfrozen_revision", "pack_integrity_failure", "report_pack_mismatch", "historical_evidence_pack"
  ].includes(issue))) return "revision_mismatch";
  return issueCodes.includes("missing_materials") ? "missing" : "healthy";
}

function qualityWithHoldingFailure(
  quality: TodayResearchQuality,
  failure: { status: "stale" | "conflict" | "unavailable"; identity: unknown }
): TodayResearchQuality {
  if (failure.status === "unavailable") return quality;
  const issue: TodayResearchQuality["sourceHealth"]["issueCodes"][number] =
    failure.status === "stale" ? "holding_snapshot_stale" : "holding_snapshot_conflict";
  return {
    ...quality,
    sourceHealth: {
      ...quality.sourceHealth,
      id: sha256(canonicalJson({ researchSourceHealthId: quality.sourceHealth.id, holdingStatus: failure.status, holdingIssue: issue, holdingSource: failure.identity })),
      status: failure.status,
      issueCodes: [...new Set([...quality.sourceHealth.issueCodes, issue])]
    }
  };
}

function metadata(generatedAt: string, status: TodayResearchStatus, message: string) {
  const sourceBound = status === "available" || status === "stale" || status === "conflict";
  return makeFactMetadata({
    source: "today:deep_research_workspace:pingan_current_portfolio",
    asOf: generatedAt,
    fetchedAt: generatedAt,
    freshness: status === "available" ? "fresh" : status === "stale" ? "stale" : status === "conflict" ? "conflict" : status === "not_found" ? "missing" : "unavailable",
    provenance: sourceBound ? "research_only" : "unavailable",
    authority: sourceBound ? "research_evidence" : "unavailable",
    stale: status === "stale",
    missing: status === "not_found",
    conflict: status === "conflict",
    fixture: false,
    correctionOf: null,
    replaces: null,
    message
  });
}
