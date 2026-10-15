import type { Pool } from "pg";
import { ASSIST_HUMAN_REVIEW_WORKSPACE_SCHEMA_VERSION } from "../../../../packages/contracts/src/assistHumanReviewWorkspace.js";
import type { AssistReviewFollowUpWorkflowEnvelope } from "../../../../packages/contracts/src/assistReviewFollowUpWorkflow.js";
import {
  ASSIST_REVIEW_FOLLOW_UP_WORKFLOW_SCHEMA_VERSION,
  validateAssistReviewFollowUpWorkflowEnvelope
} from "../../../../packages/contracts/src/assistReviewFollowUpWorkflow.js";
import type {
  AssistDecisionNoteWorkflowEnvelope,
  AssistDecisionNoteWorkflowStatus,
  AssistDecisionNoteWorkflowStep
} from "../../../../packages/contracts/src/assistDecisionNoteWorkflow.js";
import {
  ASSIST_DECISION_NOTE_WORKFLOW_SCHEMA_VERSION,
  validateAssistDecisionNoteWorkflowEnvelope
} from "../../../../packages/contracts/src/assistDecisionNoteWorkflow.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import { readAssistReviewFollowUpWorkflowEnvelope } from "./assistReviewFollowUpWorkflowService.js";

export async function readAssistDecisionNoteWorkflowEnvelope(
  pool: Pool,
  membershipId: string,
  actor: AuthenticatedResearchActor,
  liveMaxAgeSeconds: number,
  now = new Date()
): Promise<AssistDecisionNoteWorkflowEnvelope> {
  const generatedAt = now.toISOString();
  if (!/^[1-9]\d*$/.test(membershipId)) {
    return assistDecisionNoteWorkflowFailClosedEnvelope(
      generatedAt,
      membershipId,
      "malformed",
      "candidate membership id must be a positive integer"
    );
  }
  const followUp = await readAssistReviewFollowUpWorkflowEnvelope(pool, membershipId, actor, liveMaxAgeSeconds, now);
  const followUpValidation = validateAssistReviewFollowUpWorkflowEnvelope(followUp);
  if (!followUpValidation.ok) {
    return assistDecisionNoteWorkflowFailClosedEnvelope(
      generatedAt,
      membershipId,
      "malformed",
      "Source follow-up workflow failed contract validation before decision note workflow assembly."
    );
  }
  if (followUp.status !== "available" && followUp.status !== "blocked_workspace") {
    return assistDecisionNoteWorkflowFailClosedEnvelope(
      generatedAt,
      membershipId,
      followUp.status,
      followUp.message,
      followUp.generatedAt,
      followUp.workspaceRef.generatedAt
    );
  }
  const workflow = assistDecisionNoteWorkflowFromFollowUp(followUp, generatedAt);
  const workflowValidation = validateAssistDecisionNoteWorkflowEnvelope(workflow);
  return workflowValidation.ok
    ? workflow
    : assistDecisionNoteWorkflowFailClosedEnvelope(
        generatedAt,
        membershipId,
        "malformed",
        "Assembled decision note workflow failed contract validation before response.",
        followUp.generatedAt,
        followUp.workspaceRef.generatedAt
      );
}

export function assistDecisionNoteWorkflowFailClosedEnvelope(
  generatedAt: string,
  membershipId: string,
  status: Exclude<AssistDecisionNoteWorkflowStatus, "available" | "blocked_follow_up">,
  message: string,
  followUpGeneratedAt = generatedAt,
  workspaceGeneratedAt = generatedAt
): AssistDecisionNoteWorkflowEnvelope {
  return {
    schemaVersion: ASSIST_DECISION_NOTE_WORKFLOW_SCHEMA_VERSION,
    generatedAt,
    status,
    target: {
      market: "HK",
      code: "00000",
      symbol: "HK.00000",
      candidateMembershipId: membershipId
    },
    sourceWorkspaceRef: {
      schemaVersion: ASSIST_HUMAN_REVIEW_WORKSPACE_SCHEMA_VERSION,
      route: "/api/mobile/research/candidate-memberships/:id/human-review-workspace",
      status,
      generatedAt: workspaceGeneratedAt
    },
    sourceFollowUpWorkflowRef: {
      schemaVersion: ASSIST_REVIEW_FOLLOW_UP_WORKFLOW_SCHEMA_VERSION,
      route: "/api/mobile/research/candidate-memberships/:id/human-review-workspace/follow-up-workflow",
      status,
      generatedAt: followUpGeneratedAt
    },
    noteState: "fail_closed",
    decisionNoteDraft: null,
    factReferences: [],
    unresolvedEvidenceGaps: [],
    laterReviewEntry: null,
    blockedExternalActions: assistDecisionNoteBlockedExternalActions(),
    steps: [assistDecisionNoteStep(
      "stop_due_to_unavailable_source",
      "Stop because source workflow is unavailable",
      "Do not draft a local decision note until the workspace and follow-up workflow can be loaded.",
      true,
      null
    )],
    failClosed: {
      active: true,
      reason: message,
      clearsDraft: true,
      noStaleFacts: true,
      noStaleDraft: true,
      noPartialFacts: true,
      noUsableStaleReferences: true
    },
    safety: assistDecisionNoteSafety(),
    provenance: assistDecisionNoteProvenance(),
    message
  };
}

function assistDecisionNoteWorkflowFromFollowUp(
  followUp: AssistReviewFollowUpWorkflowEnvelope,
  generatedAt: string
): AssistDecisionNoteWorkflowEnvelope {
  const blocked = followUp.status === "blocked_workspace" || followUp.steps.some((step) => step.id === "stop_due_to_blocked_workspace" && step.enabled);
  const draft = {
    id: "decision_note_draft" as const,
    label: "Decision note draft",
    placeholder: "Draft a local decision note grounded in the visible workspace facts. It is not an official record, not persisted, and not sent.",
    draftValue: null,
    localOnly: true as const,
    officialRecord: false as const,
    persists: false as const,
    sent: false as const,
    maxLength: 2000,
    allowedInterpretation: "This is local client display intent for human review only.",
    forbiddenInterpretation: "This does not persist an official review record, create investment guidance, call a broker, or mutate portfolio facts."
  };
  return {
    schemaVersion: ASSIST_DECISION_NOTE_WORKFLOW_SCHEMA_VERSION,
    generatedAt,
    status: blocked ? "blocked_follow_up" : "available",
    target: followUp.target,
    sourceWorkspaceRef: {
      schemaVersion: followUp.workspaceRef.schemaVersion,
      route: followUp.workspaceRef.route,
      status: followUp.workspaceRef.status,
      generatedAt: followUp.workspaceRef.generatedAt
    },
    sourceFollowUpWorkflowRef: {
      schemaVersion: followUp.schemaVersion,
      route: "/api/mobile/research/candidate-memberships/:id/human-review-workspace/follow-up-workflow",
      status: followUp.status,
      generatedAt: followUp.generatedAt
    },
    noteState: blocked ? "blocked_follow_up" : "draft_ready",
    decisionNoteDraft: draft,
    factReferences: [
      assistDecisionNoteFactReference(
        "workspace_readiness",
        "Workspace readiness",
        "human_review_workspace",
        `Workspace status ${followUp.workspaceRef.status}; readiness ${followUp.workspaceRef.readinessId}.`,
        true
      ),
      assistDecisionNoteFactReference(
        "follow_up_state",
        "Follow-up workflow state",
        "review_follow_up_workflow",
        `Follow-up state ${followUp.followUpState}; review state ${followUp.reviewState}.`,
        true
      ),
      assistDecisionNoteFactReference(
        "safety_boundary",
        "Safety boundary",
        "safety_boundary",
        "Local note drafting is advisory-only, manual-review-only, non-persistent, unsent, and cannot create trading, broker, portfolio, cash, fee, or position behavior.",
        true
      )
    ],
    unresolvedEvidenceGaps: followUp.unresolvedEvidenceGaps,
    laterReviewEntry: followUp.laterReviewIntent?.placeholder ?? "Later-review entry is local-only and not persisted.",
    blockedExternalActions: assistDecisionNoteBlockedExternalActions(),
    steps: [
      assistDecisionNoteStep(
        "inspect_source_workspace",
        "Inspect source workspace",
        "Review source workspace readiness before drafting a decision note.",
        true,
        null
      ),
      assistDecisionNoteStep(
        "inspect_follow_up_workflow",
        "Inspect follow-up workflow",
        "Review follow-up state and unresolved evidence gaps before drafting.",
        true,
        null
      ),
      assistDecisionNoteStep(
        "draft_local_decision_note",
        "Draft local decision note",
        "Draft a client-local decision note that is not persisted and not sent.",
        !blocked,
        blocked ? "Follow-up workflow is blocked; keep draft empty until source facts are usable." : null
      ),
      assistDecisionNoteStep(
        "review_fact_references",
        "Review fact references",
        "Use only visible workspace and follow-up facts as local note references.",
        true,
        null
      ),
      assistDecisionNoteStep(
        "review_evidence_gaps",
        "Review evidence gaps",
        "Inspect unresolved evidence gaps before any local decision note wording.",
        followUp.unresolvedEvidenceGaps.length > 0,
        followUp.unresolvedEvidenceGaps.length > 0 ? null : "No unresolved evidence gaps were reported."
      ),
      assistDecisionNoteStep(
        "set_later_review_entry",
        "Set later-review entry",
        "Keep later-review entry as local display intent only.",
        true,
        null
      ),
      assistDecisionNoteStep(
        "stop_due_to_unavailable_source",
        "Stop when source is unavailable",
        "Stop if the source workspace or follow-up workflow becomes fail-closed.",
        blocked,
        blocked ? null : "Source workflow is available."
      )
    ],
    failClosed: {
      active: false,
      reason: null,
      clearsDraft: true,
      noStaleFacts: true,
      noStaleDraft: true,
      noPartialFacts: true,
      noUsableStaleReferences: true
    },
    safety: assistDecisionNoteSafety(),
    provenance: assistDecisionNoteProvenance(),
    message: `Local decision note workflow for ${followUp.target.symbol}: draft-only, not official, not persisted, and not sent.`
  };
}

function assistDecisionNoteFactReference(
  id: string,
  label: string,
  source: AssistDecisionNoteWorkflowEnvelope["factReferences"][number]["source"],
  summary: string,
  available: boolean
): AssistDecisionNoteWorkflowEnvelope["factReferences"][number] {
  return {
    id,
    label,
    source,
    summary,
    localOnly: true,
    available
  };
}

function assistDecisionNoteStep(
  id: AssistDecisionNoteWorkflowStep["id"],
  label: string,
  description: string,
  enabled: boolean,
  disabledReason: string | null
): AssistDecisionNoteWorkflowStep {
  return {
    id,
    label,
    description,
    enabled,
    disabledReason,
    localOnly: true,
    persists: false,
    allowedInterpretation: "Use this as a client-local decision note workflow step only.",
    forbiddenInterpretation: "Do not treat this as investment advice, execution authority, account authority, broker truth, portfolio authority, or production readiness."
  };
}

function assistDecisionNoteBlockedExternalActions(): string[] {
  return [
    "No execution orders",
    "No account or broker calls",
    "No live holdings sync",
    "No portfolio mutation",
    "No persisted note write",
    "No official review record",
    "No production release"
  ];
}

function assistDecisionNoteSafety(): AssistDecisionNoteWorkflowEnvelope["safety"] {
  return {
    advisoryOnly: true,
    manualReviewOnly: true,
    localDraftOnly: true,
    noOfficialRecord: true,
    noPersistence: true,
    notSent: true,
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
    noBroker: true,
    noPortfolioMutation: true,
    noCashMutation: true,
    noFeeMutation: true,
    noPositionMutation: true,
    noProductionClaim: true
  };
}

function assistDecisionNoteProvenance(): AssistDecisionNoteWorkflowEnvelope["provenance"] {
  return {
    sourceWorkspace: "assist_human_review_workspace_v1",
    sourceFollowUpWorkflow: "assist_review_followup_workflow_v1",
    draftStorage: "client_memory_only",
    persistence: "omitted",
    runtime: "repository_local_only",
    externalAccounts: "omitted",
    portfolio: "omitted"
  };
}
