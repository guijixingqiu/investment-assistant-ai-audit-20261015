import { makeFactMetadata } from "../../../../packages/contracts/src/factMetadata.js";
import type { CandidateDecisionIntakeEnvelope } from "../../../../packages/contracts/src/candidateDecisionIntake.js";
import type {
  AnnualDecisionBriefData,
  AnnualDecisionBriefEnvelope,
  AnnualDecisionBriefVariable
} from "../../../../packages/contracts/src/annualDecisionBrief.js";
import {
  ANNUAL_DECISION_BRIEF_SCHEMA_VERSION,
  validateAnnualDecisionBriefEnvelope
} from "../../../../packages/contracts/src/annualDecisionBrief.js";
import type { EvidenceItemData } from "../../../../packages/contracts/src/research.js";

export function annualDecisionBriefFromIntake(
  intake: CandidateDecisionIntakeEnvelope,
  now = new Date()
): AnnualDecisionBriefEnvelope {
  const generatedAt = now.toISOString();
  if (intake.status !== "available" || !intake.membership || !intake.decisionContext || !intake.requestedSymbol) {
    return annualDecisionBriefFailClosedEnvelope(
      generatedAt,
      intake.membershipId,
      intake.requestedActorId,
      intake.status === "not_found" ? "not_found" : "unavailable",
      intake.message
    );
  }

  const membership = intake.membership;
  const context = intake.decisionContext;
  const research = context.research;
  const profile = research.profile;
  const support = research.evidence.filter((item) => item.stance === "support");
  const counter = research.evidence.filter((item) => item.stance === "refute");
  const neutral = research.evidence.filter((item) => item.stance === "neutral");
  const explicitGaps = uniqueStrings(profile?.evidenceGaps ?? []);
  const variables = buildVariables(profile?.keyVariables ?? [], [...support, ...counter, ...neutral]);
  const conflicts = buildConflicts(research.evidence);
  const catalysts = uniqueStrings(profile?.catalysts ?? []);
  const freshness = combinedBriefFreshness(
    effectiveBriefFreshness(research.metadata),
    effectiveBriefFreshness(context.quote.metadata),
    effectiveBriefFreshness(context.quantEvidence.metadata)
  );
  const readiness = buildReadiness({
    membershipState: membership.state,
    intakeNextAction: intake.nextAction.state,
    researchStatus: research.status,
    quoteStatus: context.quote.status,
    quantStatus: context.quantEvidence.status,
    quantFreshness: context.quantEvidence.metadata.freshness,
    quantAsOf: context.quantEvidence.metadata.asOf,
    quantFetchedAt: context.quantEvidence.metadata.fetchedAt,
    aggregateFreshness: freshness,
    whyNow: profile?.currentView ?? null,
    thesis: profile?.currentThesis ?? null,
    marketDisagreement: profile?.marketDisagreement ?? null,
    invalidationCondition: profile?.invalidationCondition ?? null,
    variables,
    catalysts,
    support,
    counter,
    gaps: explicitGaps
  });
  const fixture = research.metadata.fixture
    || context.quote.metadata.fixture
    || context.quantEvidence.metadata.fixture;
  const data: AnnualDecisionBriefData = {
    target: {
      membershipId: membership.id,
      membershipVersion: membership.version,
      membershipState: membership.state,
      market: "HK",
      code: membership.code,
      symbol: membership.symbol
    },
    sourceIdentity: {
      generatedAt,
      researchAsOf: research.metadata.asOf,
      evidenceAsOf: research.evidenceAsOf,
      quoteSnapshotId: context.quote.snapshotId,
      decisionContextId: context.contextId,
      decisionContextHash: context.contextHash
    },
    whyNow: profile?.currentView ?? null,
    thesis: profile?.currentThesis ?? null,
    marketDisagreement: profile?.marketDisagreement ?? null,
    invalidationCondition: profile?.invalidationCondition ?? null,
    nextReviewOn: profile?.nextReviewOn ?? null,
    keyVariables: variables,
    catalysts,
    evidence: { support, counter, neutral, conflicts, gaps: explicitGaps },
    quantEvidence: context.quantEvidence,
    readiness
  };
  const envelope: AnnualDecisionBriefEnvelope = {
    schemaVersion: ANNUAL_DECISION_BRIEF_SCHEMA_VERSION,
    generatedAt,
    status: "available",
    membershipId: membership.id,
    requestedActorId: intake.requestedActorId,
    requestedSymbol: membership.symbol,
    metadata: makeFactMetadata({
      source: "annual_decision_brief:candidate_intake_research_quant",
      asOf: research.metadata.asOf ?? generatedAt,
      fetchedAt: generatedAt,
      freshness,
      provenance: fixture ? "fixture" : research.metadata.provenance,
      authority: "research_evidence",
      stale: freshness === "stale",
      missing: profile === null || freshness === "missing",
      conflict: freshness === "conflict",
      fixture,
      correctionOf: research.metadata.correctionOf,
      replaces: research.metadata.replaces,
      message: "Decision brief groups existing actor-scoped candidate, research, quote, and quant facts for manual review only."
    }),
    data,
    safety: annualDecisionBriefSafety(),
    message: `Daily decision brief for ${membership.symbol}; ${readiness.state}.`
  };
  return validateAnnualDecisionBriefEnvelope(envelope).ok
    ? envelope
    : annualDecisionBriefFailClosedEnvelope(
        generatedAt,
        membership.id,
        intake.requestedActorId,
        "unavailable",
        "Assembled annual decision brief failed contract validation before response."
      );
}

export function annualDecisionBriefFailClosedEnvelope(
  generatedAt: string,
  membershipId: string,
  actorId: string,
  status: "not_found" | "unavailable",
  message: string
): AnnualDecisionBriefEnvelope {
  return {
    schemaVersion: ANNUAL_DECISION_BRIEF_SCHEMA_VERSION,
    generatedAt,
    status,
    membershipId,
    requestedActorId: actorId,
    requestedSymbol: null,
    metadata: makeFactMetadata({
      source: "annual_decision_brief",
      asOf: generatedAt,
      fetchedAt: generatedAt,
      freshness: status === "not_found" ? "missing" : "unavailable",
      provenance: "unavailable",
      authority: "unavailable",
      stale: false,
      missing: status === "not_found",
      conflict: false,
      fixture: false,
      correctionOf: null,
      replaces: null,
      message
    }),
    data: null,
    safety: annualDecisionBriefSafety(),
    message
  };
}

function buildVariables(declared: string[], evidence: EvidenceItemData[]): AnnualDecisionBriefVariable[] {
  const names = uniqueStrings(declared);
  return names.map((name) => {
    const linked = evidence.filter((item) => item.variableName === name);
    return {
      name,
      evidenceIds: linked.map((item) => item.id),
      supportCount: linked.filter((item) => item.stance === "support").length,
      counterCount: linked.filter((item) => item.stance === "refute").length,
      neutralCount: linked.filter((item) => item.stance === "neutral").length,
      highestReliability: maxScore(linked.map((item) => item.reliability)),
      highestMateriality: maxScore(linked.map((item) => item.materiality ?? null))
    };
  });
}

function buildConflicts(evidence: EvidenceItemData[]): AnnualDecisionBriefData["evidence"]["conflicts"] {
  const variables = uniqueStrings(evidence.map((item) => item.variableName ?? ""));
  return variables.flatMap((variableName) => {
    const supportingEvidenceIds = evidence.filter((item) => item.variableName === variableName && item.stance === "support").map((item) => item.id);
    const counterEvidenceIds = evidence.filter((item) => item.variableName === variableName && item.stance === "refute").map((item) => item.id);
    return supportingEvidenceIds.length > 0 && counterEvidenceIds.length > 0
      ? [{ variableName, supportingEvidenceIds, counterEvidenceIds }]
      : [];
  });
}

function buildReadiness(input: {
  membershipState: "tracked" | "paused" | "archived";
  intakeNextAction: CandidateDecisionIntakeEnvelope["nextAction"]["state"];
  researchStatus: string;
  quoteStatus: string;
  quantStatus: string;
  quantFreshness: string;
  quantAsOf: string | null;
  quantFetchedAt: string | null;
  aggregateFreshness: string;
  whyNow: string | null;
  thesis: string | null;
  marketDisagreement: string | null;
  invalidationCondition: string | null;
  variables: AnnualDecisionBriefVariable[];
  catalysts: string[];
  support: EvidenceItemData[];
  counter: EvidenceItemData[];
  gaps: string[];
}): AnnualDecisionBriefData["readiness"] {
  const reasons: string[] = [];
  if (input.membershipState !== "tracked") reasons.push(`候选生命周期为 ${input.membershipState}，不是 tracked。`);
  if (input.researchStatus !== "available") reasons.push("研究证据不是当前可用状态。");
  if (input.quoteStatus !== "fresh") reasons.push("Futu 行情事实不是 fresh，不能形成当前简报。");
  if (input.quantStatus !== "available" || !["fresh", "historical"].includes(input.quantFreshness)) {
    reasons.push("量化证据不是可用的 fresh 或 historical 研究事实。");
  }
  if (!nonEmpty(input.quantAsOf) || !nonEmpty(input.quantFetchedAt)) reasons.push("量化证据缺少可追溯的事实时间。");
  if (!["fresh", "historical"].includes(input.aggregateFreshness)) reasons.push("简报来源事实存在陈旧、缺失、不可用或冲突状态。");
  if (!nonEmpty(input.whyNow)) reasons.push("尚未记录为何现在值得研究。");
  if (!nonEmpty(input.thesis)) reasons.push("尚未记录投资论点。");
  if (!nonEmpty(input.marketDisagreement)) reasons.push("尚未记录市场分歧或主要反方。");
  if (!nonEmpty(input.invalidationCondition)) reasons.push("尚未记录失效条件。");
  if (input.variables.length === 0) reasons.push("尚未记录关键变量。");
  if (input.catalysts.length === 0) reasons.push("尚未记录催化观察。");
  if (input.support.length === 0) reasons.push("尚未记录支持证据。");
  if (input.counter.length === 0 && input.gaps.length === 0) reasons.push("尚未记录反方证据或明确缺口。");
  if (input.intakeNextAction === "review_required") reasons.push("上一条人工判断仍待复盘。");
  const blocked = input.membershipState === "archived"
    || ["membership_archived", "research_missing", "quote_missing", "quote_stale", "unavailable"].includes(input.intakeNextAction)
    || input.researchStatus !== "available"
    || input.quoteStatus !== "fresh"
    || input.quantStatus !== "available"
    || !["fresh", "historical"].includes(input.quantFreshness)
    || !nonEmpty(input.quantAsOf)
    || !nonEmpty(input.quantFetchedAt)
    || !["fresh", "historical"].includes(input.aggregateFreshness);
  const state = reasons.length === 0
    ? "ready_for_three_minute_review"
    : blocked
      ? "blocked"
      : "research_required";
  return {
    state,
    reasons: uniqueStrings(reasons),
    hasCounterOrGap: input.counter.length > 0 || input.gaps.length > 0,
    threeMinuteReviewReady: state === "ready_for_three_minute_review"
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function maxScore(values: Array<number | null>): number | null {
  const scores = values.filter((value): value is number => value !== null);
  return scores.length > 0 ? Math.max(...scores) : null;
}

function nonEmpty(value: string | null): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function combinedBriefFreshness(...values: string[]): "fresh" | "historical" | "stale" | "missing" | "unavailable" | "conflict" {
  if (values.includes("conflict")) return "conflict";
  if (values.some((value) => value === "unavailable" || value === "unknown")) return "unavailable";
  if (values.includes("missing")) return "missing";
  if (values.includes("stale")) return "stale";
  if (values.includes("historical")) return "historical";
  return "fresh";
}

function effectiveBriefFreshness(metadata: {
  freshness: string;
  stale: boolean;
  missing: boolean;
  conflict: boolean;
}): string {
  if (metadata.conflict) return "conflict";
  if (metadata.missing) return "missing";
  if (metadata.stale) return "stale";
  return metadata.freshness;
}

function annualDecisionBriefSafety(): AnnualDecisionBriefEnvelope["safety"] {
  return {
    advisoryOnly: true,
    changesCandidateOrdering: false,
    recommendation: false,
    ranking: false,
    targetPrice: false,
    targetPosition: false,
    tradeDirection: false,
    createsOrder: false,
    createsTrade: false,
    callsBroker: false,
    mutatesOfficialPortfolio: false
  };
}
