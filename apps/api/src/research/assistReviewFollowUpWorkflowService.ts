import type { Pool } from "pg";
import type {
  AssistHumanReviewWorkspaceEnvelope
} from "../../../../packages/contracts/src/assistHumanReviewWorkspace.js";
import {
  ASSIST_HUMAN_REVIEW_WORKSPACE_SCHEMA_VERSION,
  validateAssistHumanReviewWorkspaceEnvelope
} from "../../../../packages/contracts/src/assistHumanReviewWorkspace.js";
import type {
  AssistReviewFollowUpWorkflowEnvelope,
  AssistReviewFollowUpWorkflowStatus,
  AssistReviewFollowUpWorkflowStep
} from "../../../../packages/contracts/src/assistReviewFollowUpWorkflow.js";
import {
  ASSIST_REVIEW_FOLLOW_UP_WORKFLOW_SCHEMA_VERSION,
  validateAssistReviewFollowUpWorkflowEnvelope
} from "../../../../packages/contracts/src/assistReviewFollowUpWorkflow.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import { readAssistHumanReviewWorkspaceEnvelope } from "./assistHumanReviewWorkspaceService.js";

export async function readAssistReviewFollowUpWorkflowEnvelope(
  pool: Pool,
  membershipId: string,
  actor: AuthenticatedResearchActor,
  liveMaxAgeSeconds: number,
  now = new Date()
): Promise<AssistReviewFollowUpWorkflowEnvelope> {
  const generatedAt = now.toISOString();
  if (!/^[1-9]\d*$/.test(membershipId)) {
    return assistReviewFollowUpWorkflowFailClosedEnvelope(
      generatedAt,
      membershipId,
      "malformed",
      "candidate membership id must be a positive integer"
    );
  }
  const workspace = await readAssistHumanReviewWorkspaceEnvelope(pool, membershipId, actor, liveMaxAgeSeconds, now);
  const workspaceValidation = validateAssistHumanReviewWorkspaceEnvelope(workspace);
  if (!workspaceValidation.ok) {
    return assistReviewFollowUpWorkflowFailClosedEnvelope(
      generatedAt,
      membershipId,
      "malformed",
      "Source human-review workspace failed contract validation before follow-up workflow assembly."
    );
  }
  if (workspace.status !== "available") {
    return assistReviewFollowUpWorkflowFailClosedEnvelope(generatedAt, membershipId, workspace.status, workspace.message, workspace.generatedAt);
  }
  const workflow = assistReviewFollowUpWorkflowFromWorkspace(workspace, generatedAt);
  const workflowValidation = validateAssistReviewFollowUpWorkflowEnvelope(workflow);
  return workflowValidation.ok
    ? workflow
    : assistReviewFollowUpWorkflowFailClosedEnvelope(
        generatedAt,
        membershipId,
        "malformed",
        "Assembled review follow-up workflow failed contract validation before response.",
        workspace.generatedAt
      );
}

export function assistReviewFollowUpWorkflowFailClosedEnvelope(
  generatedAt: string,
  membershipId: string,
  status: Exclude<AssistReviewFollowUpWorkflowStatus, "available" | "blocked_workspace">,
  message: string,
  workspaceGeneratedAt = generatedAt
): AssistReviewFollowUpWorkflowEnvelope {
  return {
    schemaVersion: ASSIST_REVIEW_FOLLOW_UP_WORKFLOW_SCHEMA_VERSION,
    generatedAt,
    status,
    target: {
      market: "HK",
      code: "00000",
      symbol: "HK.00000",
      candidateMembershipId: membershipId
    },
    workspaceRef: {
      schemaVersion: ASSIST_HUMAN_REVIEW_WORKSPACE_SCHEMA_VERSION,
      route: "/api/mobile/research/candidate-memberships/:id/human-review-workspace",
      status,
      readinessId: status === "unauthorized"
        ? "blocked_unauthorized"
        : status === "not_found"
          ? "blocked_not_found"
          : status === "malformed"
            ? "blocked_malformed"
            : "blocked_unavailable",
      generatedAt: workspaceGeneratedAt
    },
    sourceWorkspaceRef: {
      schemaVersion: ASSIST_HUMAN_REVIEW_WORKSPACE_SCHEMA_VERSION,
      route: "/api/mobile/research/candidate-memberships/:id/human-review-workspace",
      status,
      readinessId: status === "unauthorized"
        ? "blocked_unauthorized"
        : status === "not_found"
          ? "blocked_not_found"
          : status === "malformed"
            ? "blocked_malformed"
            : "blocked_unavailable",
      generatedAt: workspaceGeneratedAt
    },
    reviewState: "fail_closed",
    followUpState: "fail_closed",
    manualNoteDraft: null,
    laterReviewIntent: null,
    evidenceGaps: ["Follow-up workflow is unavailable."],
    unresolvedEvidenceGaps: ["Follow-up workflow is unavailable."],
    suggestedLocalViews: ["Stop due to blocked workspace."],
    localNextViews: ["Stop due to blocked workspace."],
    blockedExternalActions: assistReviewFollowUpBlockedExternalActions(),
    steps: [assistReviewFollowUpStep(
      "stop_due_to_blocked_workspace",
      "Stop because workspace is blocked",
      "Do not draft local follow-up until a valid human-review workspace is loaded.",
      true,
      null
    )],
    intents: [],
    failClosed: {
      active: true,
      reason: message,
      clearsDraft: true,
      noStaleWorkspaceFacts: true,
      noPartialDraftPersistence: true
    },
    safety: assistReviewFollowUpSafety(),
    provenance: assistReviewFollowUpProvenance(),
    message
  };
}

function assistReviewFollowUpWorkflowFromWorkspace(
  workspace: AssistHumanReviewWorkspaceEnvelope,
  generatedAt: string
): AssistReviewFollowUpWorkflowEnvelope {
  const blocked = workspace.readiness.blocking;
  const manualNoteDraft = assistReviewFollowUpIntent(
    "manual_note_draft",
    "Manual note draft",
    "Draft a local manual-review note. It stays in this client session only and is not an official review record."
  );
  const laterReviewIntent = assistReviewFollowUpIntent(
    "later_review_draft",
    "Later-review draft",
    "Draft a local later-review reminder intent. It stays in this client session only and is not persisted or sent."
  );
  const unresolvedEvidenceGaps = workspace.followUp.unresolvedEvidenceGaps.length > 0
    ? workspace.followUp.unresolvedEvidenceGaps
    : ["No unresolved local evidence gaps were reported by the workspace."];
  const localNextViews = workspace.followUp.suggestedLocalNextViews.length > 0
    ? workspace.followUp.suggestedLocalNextViews
    : ["Review workspace readiness."];
  const sourceWorkspaceRef = {
    schemaVersion: workspace.schemaVersion,
    route: "/api/mobile/research/candidate-memberships/:id/human-review-workspace" as const,
    status: workspace.status,
    readinessId: workspace.readiness.id,
    generatedAt: workspace.generatedAt
  };
  return {
    schemaVersion: ASSIST_REVIEW_FOLLOW_UP_WORKFLOW_SCHEMA_VERSION,
    generatedAt,
    status: blocked ? "blocked_workspace" : "available",
    target: {
      ...workspace.target,
      candidateMembershipId: workspace.target.candidateMembershipId ?? workspace.sourceEnvelopeRef.candidateMembershipId
    },
    workspaceRef: sourceWorkspaceRef,
    sourceWorkspaceRef,
    reviewState: workspace.followUp.currentReviewState,
    followUpState: blocked ? "blocked_workspace" : workspace.followUp.currentReviewState,
    manualNoteDraft,
    laterReviewIntent,
    evidenceGaps: unresolvedEvidenceGaps,
    unresolvedEvidenceGaps,
    suggestedLocalViews: localNextViews,
    localNextViews,
    blockedExternalActions: assistReviewFollowUpBlockedExternalActions(),
    steps: [
      assistReviewFollowUpStep(
        "inspect_workspace_readiness",
        "Inspect workspace readiness",
        "Review the current readiness and limitation state before drafting local follow-up.",
        true,
        null
      ),
      assistReviewFollowUpStep(
        "review_evidence_gaps",
        "Review evidence gaps",
        "Inspect unresolved local evidence gaps from the workspace.",
        workspace.followUp.unresolvedEvidenceGaps.length > 0,
        workspace.followUp.unresolvedEvidenceGaps.length > 0 ? null : "No unresolved evidence gaps were reported."
      ),
      assistReviewFollowUpStep(
        "draft_local_review_note",
        "Draft local review note",
        "Prepare a client-local note draft that is not persisted by this API.",
        !blocked,
        blocked ? "Workspace readiness is blocking; draft only after facts are available or explicitly limited." : null
      ),
      assistReviewFollowUpStep(
        "set_later_review_intent",
        "Set later-review intent",
        "Prepare a client-local later-review intent that is not persisted by this API.",
        true,
        null
      ),
      assistReviewFollowUpStep(
        "stop_due_to_blocked_workspace",
        "Stop because workspace is blocked",
        "Stop drafting when the workspace is fail-closed or blocking.",
        blocked,
        blocked ? null : "Workspace is available; stop is not the primary follow-up step."
      )
    ],
    intents: [
      manualNoteDraft,
      laterReviewIntent,
      assistReviewFollowUpIntent(
        "evidence_gap_checklist",
        "Evidence gap checklist",
        "List local evidence gaps to inspect later. It stays in this client session only and is not persisted or sent."
      )
    ],
    failClosed: {
      active: false,
      reason: null,
      clearsDraft: true,
      noStaleWorkspaceFacts: true,
      noPartialDraftPersistence: true
    },
    safety: assistReviewFollowUpSafety(),
    provenance: assistReviewFollowUpProvenance(),
    message: `Local follow-up workflow for ${workspace.target.symbol}: draft-only and not persisted.`
  };
}

function assistReviewFollowUpStep(
  id: AssistReviewFollowUpWorkflowStep["id"],
  label: string,
  description: string,
  enabled: boolean,
  disabledReason: string | null
): AssistReviewFollowUpWorkflowStep {
  return {
    id,
    label,
    description,
    enabled,
    disabledReason,
    localOnly: true,
    persists: false,
    allowedInterpretation: "Use this as a client-local manual review workflow step only.",
    forbiddenInterpretation: "Do not treat this as investment advice, execution authority, account authority, broker truth, or production readiness."
  };
}

function assistReviewFollowUpIntent(
  id: AssistReviewFollowUpWorkflowEnvelope["intents"][number]["id"],
  label: string,
  placeholder: string
): AssistReviewFollowUpWorkflowEnvelope["intents"][number] {
  return {
    id,
    label,
    placeholder,
    draftValue: null,
    localOnly: true,
    persists: false,
    maxLength: 1000,
    allowedInterpretation: "This is a local client draft intent only.",
    forbiddenInterpretation: "This does not persist data, create investment guidance, call a broker, or mutate portfolio facts."
  };
}

function assistReviewFollowUpBlockedExternalActions(): string[] {
  return [
    "No execution orders",
    "No account or broker calls",
    "No live holdings sync",
    "No portfolio mutation",
    "No persisted note write in this PR",
    "No production release"
  ];
}

function assistReviewFollowUpSafety(): AssistReviewFollowUpWorkflowEnvelope["safety"] {
  return {
    advisoryOnly: true,
    manualReviewOnly: true,
    localDraftOnly: true,
    noPersistence: true,
    noRecommendation: true,
    noRanking: true,
    noScoring: true,
    noBuySellHold: true,
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

function assistReviewFollowUpProvenance(): AssistReviewFollowUpWorkflowEnvelope["provenance"] {
  return {
    sourceWorkspace: "assist_human_review_workspace_v1",
    draftStorage: "client_memory_only",
    persistence: "omitted",
    runtime: "repository_local_only",
    externalAccounts: "omitted",
    portfolio: "omitted"
  };
}
