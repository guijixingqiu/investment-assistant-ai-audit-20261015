import type { Pool } from "pg";
import type {
  AssistAdvisoryScopeAllowedContinuation,
  AssistAdvisoryScopeEnvelope,
  AssistAdvisoryScopeFact,
  AssistAdvisoryScopeFactStatus,
  AssistAdvisoryScopeLimitation,
  AssistAdvisoryScopeLimitationKind,
  AssistAdvisoryScopeReview
} from "../../../../packages/contracts/src/assistAdvisoryScope.js";
import {
  ASSIST_ADVISORY_SCOPE_SCHEMA_VERSION,
  validateAssistAdvisoryScopeEnvelope
} from "../../../../packages/contracts/src/assistAdvisoryScope.js";
import type {
  AssistHumanReviewWorkspaceBoundaries,
  AssistHumanReviewWorkspaceContinuation,
  AssistHumanReviewWorkspaceEnvelope,
  AssistHumanReviewWorkspaceEvidenceGroup,
  AssistHumanReviewWorkspaceLimitation,
  AssistHumanReviewWorkspaceReadiness,
  AssistHumanReviewWorkspaceReadinessId,
  AssistHumanReviewWorkspaceStatus
} from "../../../../packages/contracts/src/assistHumanReviewWorkspace.js";
import {
  ASSIST_HUMAN_REVIEW_WORKSPACE_SCHEMA_VERSION,
  validateAssistHumanReviewWorkspaceEnvelope
} from "../../../../packages/contracts/src/assistHumanReviewWorkspace.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import { readAssistAdvisoryScopeEnvelope as readAssistAdvisoryScope } from "./assistAdvisoryScopeService.js";

export async function readAssistHumanReviewWorkspaceEnvelope(
  pool: Pool,
  membershipId: string,
  actor: AuthenticatedResearchActor,
  liveMaxAgeSeconds: number,
  now = new Date()
): Promise<AssistHumanReviewWorkspaceEnvelope> {
  const generatedAt = now.toISOString();
  if (!/^[1-9]\d*$/.test(membershipId)) {
    return assistHumanReviewWorkspaceFailClosedEnvelope(
      generatedAt,
      membershipId,
      "malformed",
      "candidate membership id must be a positive integer"
    );
  }
  const advisory = await readAssistAdvisoryScope(pool, membershipId, actor, liveMaxAgeSeconds, now);
  const advisoryValidation = validateAssistAdvisoryScopeEnvelope(advisory);
  if (!advisoryValidation.ok) {
    return assistHumanReviewWorkspaceFailClosedEnvelope(
      generatedAt,
      membershipId,
      "malformed",
      "Source advisory scope failed contract validation before workspace assembly."
    );
  }
  if (advisory.status !== "available") {
    return assistHumanReviewWorkspaceFailClosedEnvelope(
      generatedAt,
      membershipId,
      advisory.status,
      advisory.message
    );
  }
  const workspace = assistHumanReviewWorkspaceFromAdvisory(advisory);
  const workspaceValidation = validateAssistHumanReviewWorkspaceEnvelope(workspace);
  return workspaceValidation.ok
    ? workspace
    : assistHumanReviewWorkspaceFailClosedEnvelope(
        generatedAt,
        membershipId,
        "malformed",
        "Assembled human-review workspace failed contract validation before response."
      );
}

export function assistHumanReviewWorkspaceFailClosedEnvelope(
  generatedAt: string,
  membershipId: string,
  status: Exclude<AssistHumanReviewWorkspaceStatus, "available">,
  message: string
): AssistHumanReviewWorkspaceEnvelope {
  const readiness = assistWorkspaceReadiness(
    status === "unauthorized"
      ? "blocked_unauthorized"
      : status === "not_found"
        ? "blocked_not_found"
        : status === "malformed"
          ? "blocked_malformed"
          : "blocked_unavailable",
    message,
    true
  );
  return {
    schemaVersion: ASSIST_HUMAN_REVIEW_WORKSPACE_SCHEMA_VERSION,
    generatedAt,
    status,
    target: {
      market: "HK",
      code: "00000",
      symbol: "HK.00000",
      candidateMembershipId: membershipId
    },
    readiness,
    evidenceGroups: [],
    limitations: [{
      kind: status,
      severity: "blocking",
      label: "Workspace unavailable",
      explanation: message,
      userImpact: "No local human-review workspace facts are usable for this request.",
      allowedInterpretation: "Stop and refresh repository-local facts after the failure is resolved.",
      forbiddenInterpretation: "Do not reuse older workspace facts, infer a recommendation, or treat this as buy/sell/hold guidance."
    }],
    continuations: [assistWorkspaceContinuation(
      "stop_due_to_unavailable_facts",
      "Stop because facts are unavailable",
      "Do not continue local review until a valid workspace can be loaded.",
      "stop",
      true,
      null,
      "none"
    )],
    followUp: assistWorkspaceFollowUp(readiness, ["Workspace facts are unavailable."], ["Stop due to unavailable facts."]),
    boundaries: assistWorkspaceBoundaries(),
    failClosed: {
      active: true,
      reason: message,
      noStaleFacts: true,
      noPartialFacts: true,
      notInvestmentJudgment: true
    },
    safety: assistWorkspaceSafety(),
    provenance: {
      coreFacts: "repository_local_accepted_core1",
      sourceEnvelope: "assist_advisory_scope_v1",
      pingan: "omitted",
      portfolio: "omitted",
      externalAccounts: "omitted",
      runtime: "repository_local_only"
    },
    review: {
      state: "not_started",
      message: "No review facts are exposed for this fail-closed human-review workspace.",
      latestReviewedAt: null
    },
    sourceEnvelopeRef: {
      schemaVersion: ASSIST_ADVISORY_SCOPE_SCHEMA_VERSION,
      route: "/api/mobile/research/candidate-memberships/:id/advisory-scope",
      status,
      candidateMembershipId: membershipId
    },
    message
  };
}

function assistHumanReviewWorkspaceFromAdvisory(advisory: AssistAdvisoryScopeEnvelope): AssistHumanReviewWorkspaceEnvelope {
  const readiness = assistWorkspaceReadinessFromAdvisory(advisory);
  const evidenceGroups = assistWorkspaceEvidenceGroups(advisory);
  const limitations = assistWorkspaceLimitations(advisory);
  const continuations = assistWorkspaceContinuations(advisory, readiness);
  return {
    schemaVersion: ASSIST_HUMAN_REVIEW_WORKSPACE_SCHEMA_VERSION,
    generatedAt: advisory.generatedAt,
    status: "available",
    target: advisory.target,
    readiness,
    evidenceGroups,
    limitations,
    continuations,
    followUp: assistWorkspaceFollowUp(
      readiness,
      limitations
        .filter((limitation) => limitation.severity === "blocking" || limitation.severity === "review_limited")
        .map((limitation) => limitation.label),
      continuations.filter((continuation) => continuation.enabled).map((continuation) => continuation.label)
    ),
    boundaries: assistWorkspaceBoundaries(),
    failClosed: {
      active: false,
      reason: null,
      noStaleFacts: true,
      noPartialFacts: true,
      notInvestmentJudgment: true
    },
    safety: assistWorkspaceSafety(),
    provenance: {
      coreFacts: "repository_local_accepted_core1",
      sourceEnvelope: "assist_advisory_scope_v1",
      pingan: advisory.provenance?.pingan ?? "historical_last_imported_only",
      portfolio: "omitted",
      externalAccounts: "omitted",
      runtime: "repository_local_only"
    },
    review: {
      state: advisory.review?.status ?? "not_started",
      message: advisory.review?.message ?? "No local review facts are available.",
      latestReviewedAt: advisory.review?.latestReviewedAt ?? null
    },
    sourceEnvelopeRef: {
      schemaVersion: advisory.schemaVersion,
      route: "/api/mobile/research/candidate-memberships/:id/advisory-scope",
      status: advisory.status,
      candidateMembershipId: advisory.candidateMembershipId ?? advisory.target.candidateMembershipId ?? null
    },
    message: `Local human-review workspace for ${advisory.target.symbol}: ${readiness.explanation}`
  };
}

function assistWorkspaceReadinessFromAdvisory(advisory: AssistAdvisoryScopeEnvelope): AssistHumanReviewWorkspaceReadiness {
  const statuses = new Set(advisory.facts.map((fact) => fact.status));
  const hasContinuation = (id: AssistAdvisoryScopeAllowedContinuation) => advisory.allowedContinuations.includes(id);
  if (statuses.size === 0 || advisory.facts.every((fact) => fact.status === "empty")) {
    return assistWorkspaceReadiness("empty_local_scope", "No accepted local facts are available for this selected candidate.", true);
  }
  if (statuses.has("research_missing") || statuses.has("quote_missing")) {
    return assistWorkspaceReadiness("blocked_missing_facts", "Required research or quote facts are missing for local manual review.", true);
  }
  if (statuses.has("quote_stale")) {
    return assistWorkspaceReadiness("blocked_stale_facts", "Persisted quote facts are stale and must be refreshed or reviewed as a limitation.", true);
  }
  if (statuses.has("review_required")) {
    return assistWorkspaceReadiness("blocked_review_required", "A prior decision check needs post-decision review before new preparation.", true);
  }
  if (statuses.has("membership_archived") || statuses.has("decision_context_limited") || statuses.has("evidence_gap") || statuses.has("historical_context_limited")) {
    return assistWorkspaceReadiness("review_limited", "Local facts can be inspected, but one or more boundaries limit the review.", true);
  }
  if (statuses.has("human_check_pending") && !hasContinuation("complete_human_check")) {
    return assistWorkspaceReadiness("blocked_human_check_pending", "Manual human-check facts are still pending and no safe completion continuation is available.", true);
  }
  return assistWorkspaceReadiness("ready_for_manual_review", "Facts are available for local manual review only.", false);
}

function assistWorkspaceReadiness(
  id: AssistHumanReviewWorkspaceReadinessId,
  explanation: string,
  blocking: boolean
): AssistHumanReviewWorkspaceReadiness {
  const labelById: Record<AssistHumanReviewWorkspaceReadinessId, string> = {
    ready_for_manual_review: "Ready for manual review",
    review_limited: "Manual review limited",
    blocked_missing_facts: "Blocked by missing facts",
    blocked_stale_facts: "Blocked by stale facts",
    blocked_human_check_pending: "Blocked by pending human check",
    blocked_review_required: "Blocked by required review",
    blocked_unauthorized: "Blocked by missing read authorization",
    blocked_not_found: "Blocked because membership was not found",
    blocked_unavailable: "Blocked because repository facts are unavailable",
    blocked_malformed: "Blocked because workspace facts were malformed",
    empty_local_scope: "No local workspace facts"
  };
  return {
    id,
    label: labelById[id],
    explanation,
    allowedInterpretation: "Use this as a repository-local manual review readiness explanation only.",
    forbiddenInterpretation: "Do not interpret this as a recommendation, buy/sell/hold signal, trade-ready state, portfolio advice, broker account truth, or production release.",
    blocking,
    manualReviewOnly: true,
    tradeReady: false,
    recommendation: false
  };
}

function assistWorkspaceEvidenceGroups(advisory: AssistAdvisoryScopeEnvelope): AssistHumanReviewWorkspaceEvidenceGroup[] {
  const groupForFact = (
    id: AssistHumanReviewWorkspaceEvidenceGroup["id"],
    title: string,
    fact: AssistAdvisoryScopeFact | undefined
  ): AssistHumanReviewWorkspaceEvidenceGroup => {
    const mapped = assistWorkspaceEvidenceStatus(fact?.status ?? "empty");
    return {
      id,
      title,
      status: mapped.status,
      severity: mapped.severity,
      summary: fact?.message ?? "No local fact is available for this evidence group.",
      facts: fact ? [`${fact.label}: ${fact.status}; ${fact.message}`] : [],
      limitations: fact?.staleReason ? [`Stale reason: ${fact.staleReason}`] : [],
      source: fact?.source === "pingan_historical_last_imported" ? "pingan_historical_last_imported" : "accepted_core1_fact",
      observedAt: fact?.observedAt ?? null,
      staleReason: fact?.staleReason ?? null,
      allowedInterpretation: "This group can explain local manual review readiness.",
      forbiddenInterpretation: "This group cannot be used as investment advice, live holdings, broker truth, or trade authority."
    };
  };
  const fact = (kind: AssistAdvisoryScopeFact["kind"]) => advisory.facts.find((item) => item.kind === kind);
  return [
    groupForFact("candidate_identity", "Candidate identity", fact("candidate_membership")),
    groupForFact("quote_evidence", "Quote evidence", fact("quote")),
    groupForFact("research_evidence", "Research evidence", fact("research")),
    groupForFact("decision_context", "Decision context", fact("decision_context")),
    groupForFact("human_check", "Human check", fact("human_check")),
    groupForFact("post_decision_review", "Post-decision review", fact("post_decision_review")),
    groupForFact("pingan_historical_context", "Pingan historical context", fact("pingan_last_imported")),
    {
      id: "portfolio_omitted_boundary",
      title: "Portfolio omitted boundary",
      status: "omitted_boundary",
      severity: "safety_boundary",
      summary: "Portfolio, position, cash, fee, and account authority are omitted from this workspace.",
      facts: ["Portfolio provenance is omitted by contract."],
      limitations: ["No portfolio or live holdings conclusion is available from this workspace."],
      source: "portfolio_omitted",
      observedAt: null,
      staleReason: null,
      allowedInterpretation: "Treat portfolio facts as outside this local workspace.",
      forbiddenInterpretation: "Do not infer allocation, sizing, exposure, cash, positions, or portfolio mutation."
    },
    {
      id: "client_fail_closed_state",
      title: "Client fail-closed state",
      status: "safety_boundary",
      severity: "safety_boundary",
      summary: "Clients must clear older workspace facts when a newer workspace read is unavailable, malformed, unauthorized, offline, or superseded.",
      facts: ["Fail-closed display state does not reuse stale or partial workspace facts."],
      limitations: ["Only a valid available workspace may expose evidence groups."],
      source: "client_fail_closed_state",
      observedAt: advisory.generatedAt,
      staleReason: null,
      allowedInterpretation: "Use this as a UI state boundary for local manual review.",
      forbiddenInterpretation: "Do not treat prior rendered facts as usable after a failed workspace read."
    },
    {
      id: "safety_boundary",
      title: "Safety boundary",
      status: "safety_boundary",
      severity: "safety_boundary",
      summary: "Workspace is manual-review-only and cannot create execution or account authority.",
      facts: ["No recommendation, ranking, scoring, trading, broker, portfolio, cash, fee, or position authority is present."],
      limitations: ["Production release remains NO_GO."],
      source: "safety_boundary",
      observedAt: advisory.generatedAt,
      staleReason: null,
      allowedInterpretation: "Use this as a safety boundary for local manual review.",
      forbiddenInterpretation: "Do not treat this workspace as production-ready or trade-ready."
    }
  ];
}

function assistWorkspaceEvidenceStatus(status: AssistAdvisoryScopeFactStatus): Pick<AssistHumanReviewWorkspaceEvidenceGroup, "status" | "severity"> {
  if (status === "ready_for_human_review" || status === "review_complete") return { status: "available_for_manual_review", severity: "context_only" };
  if (status === "research_missing" || status === "quote_missing") return { status: "missing", severity: "blocking" };
  if (status === "quote_stale") return { status: "stale", severity: "review_limited" };
  if (status === "historical_context_limited") return { status: "historical_context", severity: "context_only" };
  if (status === "empty") return { status: "empty", severity: "review_limited" };
  if (status === "membership_archived" || status === "decision_context_limited" || status === "human_check_pending" || status === "review_required" || status === "context_snapshot_unavailable" || status === "evidence_conflict" || status === "evidence_gap") {
    return { status: "review_limited", severity: status === "human_check_pending" ? "review_limited" : "blocking" };
  }
  return { status: "review_limited", severity: "review_limited" };
}

function assistWorkspaceLimitations(advisory: AssistAdvisoryScopeEnvelope): AssistHumanReviewWorkspaceLimitation[] {
  const limitations: AssistHumanReviewWorkspaceLimitation[] = advisory.limitations.map((limitation) => {
    const severity = assistWorkspaceLimitationSeverity(limitation.kind);
    return {
      kind: limitation.kind,
      severity,
      label: assistWorkspaceLimitationLabel(limitation.kind),
      explanation: limitation.message,
      userImpact: severity === "blocking"
        ? "Manual review cannot proceed without acknowledging or resolving this blocking fact."
        : severity === "review_limited"
          ? "Manual review can inspect facts only with this explicit limitation."
          : severity === "safety_boundary"
            ? "This boundary prevents recommendation, trading, broker, portfolio, or production interpretation."
            : "This is contextual background only.",
      allowedInterpretation: "Use this limitation to understand local manual-review readiness.",
      forbiddenInterpretation: "Do not convert this limitation into buy/sell/hold guidance or portfolio advice."
    };
  });
  limitations.push({
    kind: "portfolio_omitted",
    severity: "safety_boundary",
    label: "Portfolio omitted",
    explanation: "Portfolio, live holdings, cash, fees, positions, and account authority are outside this workspace.",
    userImpact: "No portfolio or broker-account conclusion can be drawn.",
    allowedInterpretation: "The workspace is local fact review only.",
    forbiddenInterpretation: "Do not infer allocation, sizing, exposure, cash, positions, or portfolio mutation."
  });
  return limitations;
}

function assistWorkspaceLimitationSeverity(kind: AssistAdvisoryScopeLimitationKind): AssistHumanReviewWorkspaceLimitation["severity"] {
  if (kind === "missing_research" || kind === "missing_quote" || kind === "review_required" || kind === "decision_context_unavailable" || kind === "context_snapshot_unavailable") return "blocking";
  if (kind === "stale_quote" || kind === "human_check_pending") return "review_limited";
  if (kind === "historical_pingan_only") return "context_only";
  return "blocking";
}

function assistWorkspaceLimitationLabel(kind: AssistAdvisoryScopeLimitationKind): string {
  return kind.split("_").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}

function assistWorkspaceContinuations(advisory: AssistAdvisoryScopeEnvelope, readiness: AssistHumanReviewWorkspaceReadiness): AssistHumanReviewWorkspaceContinuation[] {
  const mapped = advisory.allowedContinuations.map((continuation) => assistWorkspaceContinuationFromAdvisory(continuation, readiness));
  mapped.push(
    assistWorkspaceContinuation(
      "record_local_review_note",
      "Record local review note intent",
      "Prepare a local note intent for future review workflow; this PR does not persist it.",
      "local_intent",
      true,
      null,
      "local_display_intent"
    ),
    assistWorkspaceContinuation(
      "mark_for_later_manual_review",
      "Mark for later manual review intent",
      "Prepare a local later-review intent for a future safe workflow; this PR does not persist it.",
      "local_intent",
      true,
      null,
      "local_display_intent"
    )
  );
  return [...new Map(mapped.map((item) => [item.id, item])).values()];
}

function assistWorkspaceContinuationFromAdvisory(
  continuation: AssistAdvisoryScopeAllowedContinuation,
  readiness: AssistHumanReviewWorkspaceReadiness
): AssistHumanReviewWorkspaceContinuation {
  const mapped: Record<AssistAdvisoryScopeAllowedContinuation, AssistHumanReviewWorkspaceContinuation["id"]> = {
    view_candidate: "view_candidate_facts",
    view_decision_context: "view_decision_context_facts",
    complete_human_check: "complete_manual_human_check",
    inspect_post_decision_review: "inspect_post_decision_review",
    view_pingan_historical_context: "view_pingan_historical_context",
    stop_due_to_unavailable_facts: "stop_due_to_unavailable_facts"
  };
  const id = mapped[continuation];
  const enabled = id === "stop_due_to_unavailable_facts" ? readiness.blocking : true;
  return assistWorkspaceContinuation(
    id,
    assistWorkspaceContinuationLabel(id),
    assistWorkspaceContinuationDescription(id),
    id === "stop_due_to_unavailable_facts" ? "stop" : id === "complete_manual_human_check" || id === "inspect_post_decision_review" ? "manual_review" : "view",
    enabled,
    enabled ? null : "Facts are available; stopping is only active for blocked or fail-closed workspace states.",
    "none"
  );
}

function assistWorkspaceContinuation(
  id: AssistHumanReviewWorkspaceContinuation["id"],
  label: string,
  description: string,
  category: AssistHumanReviewWorkspaceContinuation["category"],
  enabled: boolean,
  disabledReason: string | null,
  sideEffectLevel: AssistHumanReviewWorkspaceContinuation["sideEffectLevel"]
): AssistHumanReviewWorkspaceContinuation {
  return {
    id,
    label,
    description,
    category,
    enabled,
    disabledReason,
    sideEffectLevel,
    allowedInterpretation: "This is a local manual-review or navigation continuation only.",
    forbiddenInterpretation: "This is not a recommendation, trading instruction, broker call, portfolio mutation, or production action."
  };
}

function assistWorkspaceContinuationLabel(id: AssistHumanReviewWorkspaceContinuation["id"]): string {
  const labels: Record<AssistHumanReviewWorkspaceContinuation["id"], string> = {
    view_candidate_facts: "View candidate facts",
    view_decision_context_facts: "View decision context facts",
    complete_manual_human_check: "Complete manual human check",
    inspect_post_decision_review: "Inspect post-decision review",
    view_pingan_historical_context: "View Pingan historical context",
    record_local_review_note: "Record local review note intent",
    mark_for_later_manual_review: "Mark for later manual review intent",
    stop_due_to_unavailable_facts: "Stop because facts are unavailable"
  };
  return labels[id];
}

function assistWorkspaceContinuationDescription(id: AssistHumanReviewWorkspaceContinuation["id"]): string {
  const descriptions: Record<AssistHumanReviewWorkspaceContinuation["id"], string> = {
    view_candidate_facts: "Open the selected candidate membership facts.",
    view_decision_context_facts: "Open local decision context facts for manual inspection.",
    complete_manual_human_check: "Continue to the existing manual human-check workflow when facts allow it.",
    inspect_post_decision_review: "Inspect the local post-decision review requirement.",
    view_pingan_historical_context: "Inspect Pingan context only as historical or last-imported background.",
    record_local_review_note: "Prepare a local note intent without database persistence in this PR.",
    mark_for_later_manual_review: "Prepare a local later-review intent without database persistence in this PR.",
    stop_due_to_unavailable_facts: "Stop because usable local facts are unavailable or fail-closed."
  };
  return descriptions[id];
}

function assistWorkspaceFollowUp(
  readiness: AssistHumanReviewWorkspaceReadiness,
  unresolvedEvidenceGaps: string[],
  suggestedLocalNextViews: string[]
): AssistHumanReviewWorkspaceEnvelope["followUp"] {
  return {
    currentReviewState: readiness.id,
    manualNoteIntent: "Local display intent only; no note is persisted by this workspace v1.",
    laterReviewIntent: "Local display intent only; later-review persistence is reserved for a future governed workflow.",
    unresolvedEvidenceGaps,
    suggestedLocalNextViews,
    blockedExternalActions: [
      "No execution orders",
      "No account or broker calls",
      "No live holdings sync",
      "No portfolio mutation",
      "No production release"
    ],
    productionNoGoReason: "Production release remains NO_GO because release-environment blockers #66, #65, #64, and #58 remain unresolved."
  };
}

function assistWorkspaceBoundaries(): AssistHumanReviewWorkspaceBoundaries {
  return {
    noRecommendation: true,
    noRanking: true,
    noScoring: true,
    noBuySellHold: true,
    noTiming: true,
    noTargetPrice: true,
    noStopLoss: true,
    noTakeProfit: true,
    noExpectedReturn: true,
    noSizing: true,
    noAllocation: true,
    noOrder: true,
    noTrade: true,
    noFill: true,
    noCashMutation: true,
    noFeeMutation: true,
    noPositionMutation: true,
    noBroker: true,
    noPortfolioMutation: true,
    noProductionClaim: true,
    pinganHistoricalOnly: true,
    portfolioOmitted: true,
    externalRuntimeNotUsed: true
  };
}

function assistWorkspaceSafety(): AssistHumanReviewWorkspaceEnvelope["safety"] {
  return {
    ...assistWorkspaceBoundaries(),
    advisoryOnly: true,
    manualReviewOnly: true
  };
}
