import type { CandidateMembershipData } from "../../../packages/contracts/src/candidateMembership.js";
import type { CoreJourneyData } from "./coreJourneyState.js";
import { quantDecisionEvidenceLines } from "./quantDecisionEvidencePresentation.js";
import type { CandidateMembershipRenderModel } from "./candidateMembershipState.js";
import type { AssistAdvisoryScopeRenderModel, AssistAdvisoryScopeUiState } from "./assistAdvisoryScopeState.js";
import type { AssistHumanReviewWorkspaceRenderModel, AssistHumanReviewWorkspaceUiState } from "./assistHumanReviewWorkspaceState.js";
import type { AssistReviewFollowUpWorkflowRenderModel, AssistReviewFollowUpWorkflowUiState } from "./assistReviewFollowUpWorkflowState.js";
import type { AssistDecisionNoteWorkflowRenderModel, AssistDecisionNoteWorkflowUiState } from "./assistDecisionNoteWorkflowState.js";
import {
  resolveSelectedCandidateMembership,
  selectedCandidateSourceIdentityMismatch,
  type SelectedCandidateMembershipGateCopy
} from "./selectedCandidateMembershipGate.js";

type SelectedCandidateDecisionContext = NonNullable<CoreJourneyData["decisionContext"]>;

const membershipSourceFailureMessage = (state: string, message: string): string =>
  `Candidate membership source is ${state}: ${message}`;

const decisionContextMembershipGateCopy = {
  candidateMissingTitle: "Selected decision-context bridge",
  candidateMissingMessage: "Open a selected candidate before linking it to decision-context facts.",
  titleForSymbol: (symbol) => `Selected decision-context bridge for ${symbol}`,
  loadingMessage: (symbol) => `Membership or decision context is loading; ${symbol} context facts stay hidden until current sources settle.`,
  membershipUnloadedMessage: "Load candidate memberships with a runtime read token before trusting decision-context facts for the selected candidate.",
  membershipSourceFailureMessage,
  membershipMissingMessage: (symbol) => `No loaded candidate membership matches selected candidate ${symbol}; old decision-context facts are not reused.`
} satisfies SelectedCandidateMembershipGateCopy;

const advisoryMembershipGateCopy = {
  candidateMissingTitle: "Selected candidate advisory bridge",
  candidateMissingMessage: "Open a selected candidate before linking it to advisory-scope facts.",
  titleForSymbol: (symbol) => `Selected advisory bridge for ${symbol}`,
  loadingMessage: (symbol) => `Membership source is loading; ${symbol} advisory facts stay hidden until current membership facts settle.`,
  membershipUnloadedMessage: "Load candidate memberships with a runtime read token before bridging advisory-scope facts.",
  membershipSourceFailureMessage,
  membershipMissingMessage: (symbol) => `No loaded candidate membership matches selected candidate ${symbol}; old advisory-scope facts are not reused.`
} satisfies SelectedCandidateMembershipGateCopy;

const humanReviewMembershipGateCopy = {
  candidateMissingTitle: "Selected candidate human-review bridge",
  candidateMissingMessage: "Open a selected candidate before linking it to human-review workspace facts.",
  titleForSymbol: (symbol) => `Selected human-review bridge for ${symbol}`,
  loadingMessage: (symbol) => `Membership source is loading; ${symbol} human-review facts stay hidden until current membership facts settle.`,
  membershipUnloadedMessage: "Load candidate memberships with a runtime read token before bridging human-review workspace facts.",
  membershipSourceFailureMessage,
  membershipMissingMessage: (symbol) => `No loaded candidate membership matches selected candidate ${symbol}; old human-review workspace facts are not reused.`
} satisfies SelectedCandidateMembershipGateCopy;

const followUpMembershipGateCopy = {
  candidateMissingTitle: "Selected candidate follow-up bridge",
  candidateMissingMessage: "Open a selected candidate before linking it to local follow-up workflow facts.",
  titleForSymbol: (symbol) => `Selected follow-up bridge for ${symbol}`,
  loadingMessage: (symbol) => `Membership source is loading; ${symbol} follow-up facts stay hidden until current membership facts settle.`,
  membershipUnloadedMessage: "Load candidate memberships with a runtime read token before bridging follow-up workflow facts.",
  membershipSourceFailureMessage,
  membershipMissingMessage: (symbol) => `No loaded candidate membership matches selected candidate ${symbol}; old follow-up workflow facts are not reused.`
} satisfies SelectedCandidateMembershipGateCopy;

const decisionNoteMembershipGateCopy = {
  candidateMissingTitle: "Selected candidate decision-note bridge",
  candidateMissingMessage: "Open a selected candidate before linking it to local decision-note workflow facts.",
  titleForSymbol: (symbol) => `Selected decision-note bridge for ${symbol}`,
  loadingMessage: (symbol) => `Membership source is loading; ${symbol} decision-note facts stay hidden until current membership facts settle.`,
  membershipUnloadedMessage: "Load candidate memberships with a runtime read token before bridging decision-note workflow facts.",
  membershipSourceFailureMessage,
  membershipMissingMessage: (symbol) => `No loaded candidate membership matches selected candidate ${symbol}; old decision-note workflow facts are not reused.`
} satisfies SelectedCandidateMembershipGateCopy;

export type SelectedCandidateDecisionContextBridgeUiState =
  | "candidate_missing"
  | "membership_unloaded"
  | "context_unloaded"
  | "loading"
  | "ready"
  | "stale_quote"
  | "quote_unavailable"
  | "research_missing"
  | "research_stale"
  | "research_unavailable"
  | "research_unauthorized"
  | "portfolio_not_omitted"
  | "source_mismatch"
  | "membership_missing"
  | "unavailable"
  | "unauthorized"
  | "not_found"
  | "malformed"
  | "offline"
  | "conflict";

export interface SelectedCandidateDecisionContextBridgeRenderModel {
  state: SelectedCandidateDecisionContextBridgeUiState;
  title: string;
  message: string;
  symbol: string | null;
  membershipId: string | null;
  membershipState: CandidateMembershipData["state"] | null;
  contextId: string | null;
  contextHash: string | null;
  contextGeneratedAt: string | null;
  quoteStatus: string | null;
  researchStatus: string | null;
  portfolioStatus: string | null;
  canUseDecisionContext: boolean;
  facts: string[];
}

export function selectedCandidateDecisionContextBridgeFromState(
  selectedSymbol: string | null,
  memberships: CandidateMembershipRenderModel,
  decisionContext: SelectedCandidateDecisionContext | null,
  membershipBusyState = false,
  journeyBusyState = false
): SelectedCandidateDecisionContextBridgeRenderModel {
  const gate = resolveSelectedCandidateMembership(
    selectedSymbol,
    memberships,
    membershipBusyState || journeyBusyState,
    decisionContextMembershipGateCopy
  );
  if (!gate.ok) {
    return selectedCandidateDecisionContextBridgeFailure(
      gate.state,
      gate.title,
      gate.message,
      gate.symbol,
      null,
      decisionContext
    );
  }
  const { title, symbol, membership } = gate;
  if (!decisionContext) {
    return selectedCandidateDecisionContextBridgeFailure(
      "context_unloaded",
      title,
      `Decision context is not loaded for ${symbol}; no previous quote, research, or portfolio boundary facts are reused.`,
      symbol,
      membership,
      decisionContext
    );
  }
  const quoteSymbol = decisionContext.quote.data?.symbol ?? null;
  const researchSymbol = decisionContext.research.profile?.symbol ?? null;
  if (
    decisionContext.requestedSymbol !== membership.symbol ||
    (quoteSymbol !== null && quoteSymbol !== membership.symbol) ||
    (researchSymbol !== null && researchSymbol !== membership.symbol)
  ) {
    return selectedCandidateDecisionContextBridgeFailure(
      "source_mismatch",
      title,
      `Fail-closed decision-context mismatch: selected ${membership.symbol}/${membership.id} differs from context ${decisionContext.requestedSymbol}; quote ${quoteSymbol ?? "unloaded"}; research ${researchSymbol ?? "unloaded"}.`,
      symbol,
      membership,
      decisionContext
    );
  }
  const state = selectedCandidateDecisionContextBridgeStateFor(decisionContext);
  const canUseDecisionContext = state === "ready";
  return {
    state,
    title,
    message: canUseDecisionContext
      ? `Selected candidate matches decision context ${decisionContext.contextId}; quote is fresh, research evidence is available, and portfolio is omitted.`
      : `Selected candidate matches decision context ${decisionContext.contextId}; state ${state} is visible but is not treated as fresh ready context.`,
    symbol,
    membershipId: membership.id,
    membershipState: membership.state,
    contextId: decisionContext.contextId,
    contextHash: decisionContext.contextHash,
    contextGeneratedAt: decisionContext.generatedAt,
    quoteStatus: decisionContext.quote.status,
    researchStatus: decisionContext.research.status,
    portfolioStatus: decisionContext.portfolio.status,
    canUseDecisionContext,
    facts: selectedCandidateDecisionContextBridgeFacts(membership, decisionContext)
  };
}

function selectedCandidateDecisionContextBridgeFailure(
  state: SelectedCandidateDecisionContextBridgeUiState,
  title: string,
  message: string,
  symbol: string | null,
  membership: CandidateMembershipData | null,
  decisionContext: SelectedCandidateDecisionContext | null
): SelectedCandidateDecisionContextBridgeRenderModel {
  return {
    state,
    title,
    message,
    symbol,
    membershipId: membership?.id ?? null,
    membershipState: membership?.state ?? null,
    contextId: decisionContext?.contextId ?? null,
    contextHash: decisionContext?.contextHash ?? null,
    contextGeneratedAt: decisionContext?.generatedAt ?? null,
    quoteStatus: decisionContext?.quote.status ?? null,
    researchStatus: decisionContext?.research.status ?? null,
    portfolioStatus: decisionContext?.portfolio.status ?? null,
    canUseDecisionContext: false,
    facts: membership ? [
      `Selected membership: ${membership.symbol}/${membership.id}; state ${membership.state}; version ${membership.version}`,
      `Decision context: ${decisionContext?.requestedSymbol ?? "unloaded"}; context ${decisionContext?.contextId ?? "unloaded"}; quote ${decisionContext?.quote.status ?? "unloaded"}; research ${decisionContext?.research.status ?? "unloaded"}; portfolio ${decisionContext?.portfolio.status ?? "unloaded"}`,
      "Fail-closed bridge: old decision context, stale quote freshness, research evidence, and portfolio authority are hidden until exact current facts match."
    ] : []
  };
}

function selectedCandidateDecisionContextBridgeStateFor(decisionContext: SelectedCandidateDecisionContext): SelectedCandidateDecisionContextBridgeUiState {
  if (decisionContext.portfolio.status !== "omitted" || decisionContext.provenance.portfolio !== "omitted") return "portfolio_not_omitted";
  if (decisionContext.quote.status === "stale") return "stale_quote";
  if (decisionContext.quote.status !== "fresh") return "quote_unavailable";
  if (decisionContext.research.status === "no_evidence") return "research_missing";
  if (decisionContext.research.status === "stale_evidence") return "research_stale";
  if (decisionContext.research.status === "unavailable") return "research_unavailable";
  if (decisionContext.research.status === "unauthorized") return "research_unauthorized";
  return "ready";
}

function selectedCandidateDecisionContextBridgeFacts(
  membership: CandidateMembershipData,
  decisionContext: SelectedCandidateDecisionContext
): string[] {
  const quoteFetchedAt = decisionContext.quote.fetchedAt ?? decisionContext.quote.staleReason ?? "unavailable";
  const quoteSource = decisionContext.quote.source ?? "missing source";
  const researchAsOf = decisionContext.research.evidenceAsOf ?? decisionContext.research.staleReason ?? "unavailable";
  return [
    `Selected candidate: ${membership.symbol}; membership ${membership.id}; state ${membership.state}; version ${membership.version}`,
    `Decision context: ${decisionContext.contextId}; hash ${decisionContext.contextHash}; generated ${decisionContext.generatedAt}; requested ${decisionContext.requestedSymbol}`,
    `Quote freshness: ${decisionContext.quote.status}; source ${quoteSource}; fetched ${quoteFetchedAt}; snapshot ${decisionContext.quote.snapshotId ?? "none"}`,
    `Research evidence: ${decisionContext.research.status}; evidence ${decisionContext.research.evidence.length}; suggestions ${decisionContext.research.suggestions.length}; as-of ${researchAsOf}`,
    `Quant evidence: ${decisionContext.quantEvidence.status}; source ${decisionContext.quantEvidence.metadata.source}; freshness ${decisionContext.quantEvidence.metadata.freshness}; shadow ${decisionContext.quantEvidence.identities?.shadowPortfolioIdentity ?? "unavailable"}; universe ${decisionContext.quantEvidence.sampleBoundary.universe.join(",") || "unavailable"}`,
    ...quantDecisionEvidenceLines(decisionContext.quantEvidence),
    `Portfolio boundary: ${decisionContext.portfolio.status}; reason ${decisionContext.portfolio.reason}; provenance ${decisionContext.provenance.portfolio}`,
    "Bridge is read-only, exact-symbol scoped, factual context only, not official, not persisted, not sent, and cannot create orders, trades, broker calls, local-record authority, or portfolio facts."
  ];
}

export type SelectedCandidateAdvisoryScopeBridgeUiState =
  | "candidate_missing"
  | "membership_unloaded"
  | "scope_unloaded"
  | "loading"
  | "ready"
  | "empty"
  | "missing_research"
  | "missing_quote"
  | "stale_quote"
  | "review_required"
  | "limited"
  | "source_mismatch"
  | "membership_missing"
  | "unavailable"
  | "unauthorized"
  | "not_found"
  | "malformed"
  | "offline"
  | "conflict";

export interface SelectedCandidateAdvisoryScopeBridgeRenderModel {
  state: SelectedCandidateAdvisoryScopeBridgeUiState;
  title: string;
  message: string;
  symbol: string | null;
  membershipId: string | null;
  membershipState: CandidateMembershipData["state"] | null;
  scopeState: AssistAdvisoryScopeUiState | null;
  scopeGeneratedAt: string | null;
  canOpenAdvisoryScope: boolean;
  facts: string[];
}

export function selectedCandidateAdvisoryScopeBridgeFromState(
  selectedSymbol: string | null,
  memberships: CandidateMembershipRenderModel,
  advisoryScope: AssistAdvisoryScopeRenderModel,
  membershipBusyState = false,
  advisoryBusyState = false
): SelectedCandidateAdvisoryScopeBridgeRenderModel {
  const gate = resolveSelectedCandidateMembership(
    selectedSymbol,
    memberships,
    membershipBusyState,
    advisoryMembershipGateCopy
  );
  if (!gate.ok) {
    return selectedCandidateAdvisoryScopeBridgeFailure(
      gate.state,
      gate.title,
      gate.message,
      gate.symbol,
      null,
      gate.generatedAt,
      advisoryScope
    );
  }
  const { title, symbol, membership, generatedAt } = gate;
  const canOpenAdvisoryScope = !membershipBusyState && !advisoryBusyState;
  if (advisoryBusyState || advisoryScope.state === "loading") {
    return selectedCandidateAdvisoryScopeBridgeFailure(
      "loading",
      title,
      `Advisory scope is loading for ${symbol}; stale advisory facts stay hidden until current facts settle.`,
      symbol,
      membership,
      generatedAt,
      advisoryScope,
      canOpenAdvisoryScope
    );
  }
  if (advisoryScope.state === "idle") {
    return selectedCandidateAdvisoryScopeBridgeFailure(
      "scope_unloaded",
      title,
      `Advisory scope is not loaded for ${symbol}; use the bridge action to read current local advisory facts only.`,
      symbol,
      membership,
      generatedAt,
      advisoryScope,
      canOpenAdvisoryScope
    );
  }
  const scopeSourceMismatch = selectedCandidateSourceIdentityMismatch(membership, advisoryScope);
  if (scopeSourceMismatch) {
    return selectedCandidateAdvisoryScopeBridgeFailure(
      "source_mismatch",
      title,
      `Fail-closed advisory mismatch: selected ${membership.symbol}/${membership.id} differs from scope ${advisoryScope.symbol ?? "unloaded"}/${advisoryScope.membershipId ?? "unloaded"}; stale advisory facts are not trusted.`,
      symbol,
      membership,
      generatedAt,
      advisoryScope,
      canOpenAdvisoryScope
    );
  }
  if (advisoryScope.state === "unauthorized" || advisoryScope.state === "not_found" || advisoryScope.state === "conflict" || advisoryScope.state === "unavailable" || advisoryScope.state === "malformed" || advisoryScope.state === "offline") {
    return selectedCandidateAdvisoryScopeBridgeFailure(
      advisoryScope.state,
      title,
      `Advisory scope is ${advisoryScope.state}: ${advisoryScope.message}`,
      symbol,
      membership,
      generatedAt,
      advisoryScope,
      canOpenAdvisoryScope
    );
  }
  if (!advisoryScope.membershipId || !advisoryScope.symbol) {
    return selectedCandidateAdvisoryScopeBridgeFailure(
      "scope_unloaded",
      title,
      `Advisory scope has no complete source identity for ${symbol}; stale advisory facts are hidden.`,
      symbol,
      membership,
      generatedAt,
      advisoryScope,
      canOpenAdvisoryScope
    );
  }
  const state = advisoryScope.state === "available" ? "ready" : advisoryScope.state;
  return {
    state,
    title,
    message: state === "ready"
      ? `Selected candidate matches advisory scope ${advisoryScope.membershipId}; local advisory facts are current for this screen.`
      : `Selected candidate matches advisory scope ${advisoryScope.membershipId}; state ${advisoryScope.state} remains visible but is not treated as ready advice.`,
    symbol,
    membershipId: membership.id,
    membershipState: membership.state,
    scopeState: advisoryScope.state,
    scopeGeneratedAt: advisoryScope.generatedAt,
    canOpenAdvisoryScope,
    facts: selectedCandidateAdvisoryScopeBridgeFacts(membership, advisoryScope)
  };
}

function selectedCandidateAdvisoryScopeBridgeFailure(
  state: SelectedCandidateAdvisoryScopeBridgeUiState,
  title: string,
  message: string,
  symbol: string | null,
  membership: CandidateMembershipData | null,
  generatedAt: string | null,
  advisoryScope: AssistAdvisoryScopeRenderModel,
  canOpenAdvisoryScope = false
): SelectedCandidateAdvisoryScopeBridgeRenderModel {
  return {
    state,
    title,
    message,
    symbol,
    membershipId: membership?.id ?? null,
    membershipState: membership?.state ?? null,
    scopeState: advisoryScope.state,
    scopeGeneratedAt: advisoryScope.generatedAt ?? generatedAt,
    canOpenAdvisoryScope,
    facts: membership ? [
      `Selected membership: ${membership.symbol}/${membership.id}; state ${membership.state}; version ${membership.version}`,
      `Advisory scope state: ${advisoryScope.state}; membership ${advisoryScope.membershipId ?? "unloaded"}; symbol ${advisoryScope.symbol ?? "unloaded"}`,
      "Fail-closed bridge: old advisory facts are hidden and cannot become recommendation, broker, or portfolio authority."
    ] : []
  };
}

function selectedCandidateAdvisoryScopeBridgeFacts(
  membership: CandidateMembershipData,
  advisoryScope: AssistAdvisoryScopeRenderModel
): string[] {
  return [
    `Selected candidate: ${membership.symbol}; membership ${membership.id}; state ${membership.state}; version ${membership.version}`,
    `Advisory scope: ${advisoryScope.state}; generated ${advisoryScope.generatedAt ?? "not generated"}; facts ${advisoryScope.facts.length}; limitations ${advisoryScope.limitations.length}; continuations ${advisoryScope.continuations.length}.`,
    "Bridge is read-only, exact-membership scoped, advisory-only, not a recommendation, not official, not persisted, not sent, and cannot create orders, trades, broker calls, or portfolio facts."
  ];
}

export type SelectedCandidateHumanReviewWorkspaceBridgeUiState =
  | "candidate_missing"
  | "membership_unloaded"
  | "workspace_unloaded"
  | "loading"
  | "ready"
  | "review_limited"
  | "blocked"
  | "empty"
  | "source_mismatch"
  | "membership_missing"
  | "unavailable"
  | "unauthorized"
  | "not_found"
  | "malformed"
  | "offline"
  | "conflict";

export interface SelectedCandidateHumanReviewWorkspaceBridgeRenderModel {
  state: SelectedCandidateHumanReviewWorkspaceBridgeUiState;
  title: string;
  message: string;
  symbol: string | null;
  membershipId: string | null;
  membershipState: CandidateMembershipData["state"] | null;
  workspaceState: AssistHumanReviewWorkspaceUiState | null;
  workspaceGeneratedAt: string | null;
  canOpenHumanReviewWorkspace: boolean;
  facts: string[];
}

export function selectedCandidateHumanReviewWorkspaceBridgeFromState(
  selectedSymbol: string | null,
  memberships: CandidateMembershipRenderModel,
  humanReviewWorkspace: AssistHumanReviewWorkspaceRenderModel,
  membershipBusyState = false,
  workspaceBusyState = false
): SelectedCandidateHumanReviewWorkspaceBridgeRenderModel {
  const gate = resolveSelectedCandidateMembership(
    selectedSymbol,
    memberships,
    membershipBusyState,
    humanReviewMembershipGateCopy
  );
  if (!gate.ok) {
    return selectedCandidateHumanReviewWorkspaceBridgeFailure(
      gate.state,
      gate.title,
      gate.message,
      gate.symbol,
      null,
      gate.generatedAt,
      humanReviewWorkspace
    );
  }
  const { title, symbol, membership, generatedAt } = gate;
  const canOpenHumanReviewWorkspace = !membershipBusyState && !workspaceBusyState;
  if (workspaceBusyState || humanReviewWorkspace.state === "loading") {
    return selectedCandidateHumanReviewWorkspaceBridgeFailure(
      "loading",
      title,
      `Human-review workspace is loading for ${symbol}; stale workspace facts stay hidden until current facts settle.`,
      symbol,
      membership,
      generatedAt,
      humanReviewWorkspace,
      canOpenHumanReviewWorkspace
    );
  }
  if (humanReviewWorkspace.state === "idle") {
    return selectedCandidateHumanReviewWorkspaceBridgeFailure(
      "workspace_unloaded",
      title,
      `Human-review workspace is not loaded for ${symbol}; use the bridge action to read current local workspace facts only.`,
      symbol,
      membership,
      generatedAt,
      humanReviewWorkspace,
      canOpenHumanReviewWorkspace
    );
  }
  const workspaceSourceMismatch = selectedCandidateSourceIdentityMismatch(membership, humanReviewWorkspace);
  if (workspaceSourceMismatch) {
    return selectedCandidateHumanReviewWorkspaceBridgeFailure(
      "source_mismatch",
      title,
      `Fail-closed human-review mismatch: selected ${membership.symbol}/${membership.id} differs from workspace ${humanReviewWorkspace.symbol ?? "unloaded"}/${humanReviewWorkspace.membershipId ?? "unloaded"}; stale workspace facts and local follow-up drafts are not trusted.`,
      symbol,
      membership,
      generatedAt,
      humanReviewWorkspace,
      canOpenHumanReviewWorkspace
    );
  }
  if (humanReviewWorkspace.state === "unauthorized" || humanReviewWorkspace.state === "not_found" || humanReviewWorkspace.state === "conflict" || humanReviewWorkspace.state === "unavailable" || humanReviewWorkspace.state === "malformed" || humanReviewWorkspace.state === "offline") {
    return selectedCandidateHumanReviewWorkspaceBridgeFailure(
      humanReviewWorkspace.state,
      title,
      `Human-review workspace is ${humanReviewWorkspace.state}: ${humanReviewWorkspace.message}`,
      symbol,
      membership,
      generatedAt,
      humanReviewWorkspace,
      canOpenHumanReviewWorkspace
    );
  }
  if (!humanReviewWorkspace.membershipId || !humanReviewWorkspace.symbol) {
    return selectedCandidateHumanReviewWorkspaceBridgeFailure(
      "workspace_unloaded",
      title,
      `Human-review workspace has no complete source identity for ${symbol}; stale workspace facts are hidden.`,
      symbol,
      membership,
      generatedAt,
      humanReviewWorkspace,
      canOpenHumanReviewWorkspace
    );
  }
  return {
    state: humanReviewWorkspace.state,
    title,
    message: humanReviewWorkspace.state === "ready"
      ? `Selected candidate matches human-review workspace ${humanReviewWorkspace.membershipId}; local manual-review facts are current for this screen.`
      : `Selected candidate matches human-review workspace ${humanReviewWorkspace.membershipId}; state ${humanReviewWorkspace.state} remains visible but is not treated as completed review.`,
    symbol,
    membershipId: membership.id,
    membershipState: membership.state,
    workspaceState: humanReviewWorkspace.state,
    workspaceGeneratedAt: humanReviewWorkspace.generatedAt,
    canOpenHumanReviewWorkspace,
    facts: selectedCandidateHumanReviewWorkspaceBridgeFacts(membership, humanReviewWorkspace)
  };
}

function selectedCandidateHumanReviewWorkspaceBridgeFailure(
  state: SelectedCandidateHumanReviewWorkspaceBridgeUiState,
  title: string,
  message: string,
  symbol: string | null,
  membership: CandidateMembershipData | null,
  generatedAt: string | null,
  humanReviewWorkspace: AssistHumanReviewWorkspaceRenderModel,
  canOpenHumanReviewWorkspace = false
): SelectedCandidateHumanReviewWorkspaceBridgeRenderModel {
  return {
    state,
    title,
    message,
    symbol,
    membershipId: membership?.id ?? null,
    membershipState: membership?.state ?? null,
    workspaceState: humanReviewWorkspace.state,
    workspaceGeneratedAt: humanReviewWorkspace.generatedAt ?? generatedAt,
    canOpenHumanReviewWorkspace,
    facts: membership ? [
      `Selected membership: ${membership.symbol}/${membership.id}; state ${membership.state}; version ${membership.version}`,
      `Human-review workspace state: ${humanReviewWorkspace.state}; membership ${humanReviewWorkspace.membershipId ?? "unloaded"}; symbol ${humanReviewWorkspace.symbol ?? "unloaded"}`,
      "Fail-closed bridge: old workspace facts are hidden and cannot become official review, broker, or portfolio authority."
    ] : []
  };
}

function selectedCandidateHumanReviewWorkspaceBridgeFacts(
  membership: CandidateMembershipData,
  humanReviewWorkspace: AssistHumanReviewWorkspaceRenderModel
): string[] {
  return [
    `Selected candidate: ${membership.symbol}; membership ${membership.id}; state ${membership.state}; version ${membership.version}`,
    `Human-review workspace: ${humanReviewWorkspace.state}; generated ${humanReviewWorkspace.generatedAt ?? "not generated"}; readiness ${humanReviewWorkspace.readiness.length}; evidence groups ${humanReviewWorkspace.evidenceGroups.length}; follow-up facts ${humanReviewWorkspace.followUp.length}.`,
    "Bridge is read-only, exact-membership scoped, manual-review-only, not official review history, not persisted, not sent, and cannot create orders, trades, broker calls, or portfolio facts."
  ];
}

export type SelectedCandidateFollowUpWorkflowBridgeUiState =
  | "candidate_missing"
  | "membership_unloaded"
  | "workflow_unloaded"
  | "loading"
  | "ready"
  | "blocked"
  | "source_mismatch"
  | "membership_missing"
  | "unavailable"
  | "unauthorized"
  | "not_found"
  | "malformed"
  | "offline"
  | "conflict";

export interface SelectedCandidateFollowUpWorkflowBridgeRenderModel {
  state: SelectedCandidateFollowUpWorkflowBridgeUiState;
  title: string;
  message: string;
  symbol: string | null;
  membershipId: string | null;
  membershipState: CandidateMembershipData["state"] | null;
  workflowState: AssistReviewFollowUpWorkflowUiState | null;
  workflowGeneratedAt: string | null;
  canOpenFollowUpWorkflow: boolean;
  facts: string[];
}

export function selectedCandidateFollowUpWorkflowBridgeFromState(
  selectedSymbol: string | null,
  memberships: CandidateMembershipRenderModel,
  followUpWorkflow: AssistReviewFollowUpWorkflowRenderModel,
  membershipBusyState = false,
  followUpBusyState = false
): SelectedCandidateFollowUpWorkflowBridgeRenderModel {
  const gate = resolveSelectedCandidateMembership(
    selectedSymbol,
    memberships,
    membershipBusyState,
    followUpMembershipGateCopy
  );
  if (!gate.ok) {
    return selectedCandidateFollowUpWorkflowBridgeFailure(
      gate.state,
      gate.title,
      gate.message,
      gate.symbol,
      null,
      gate.generatedAt,
      followUpWorkflow
    );
  }
  const { title, symbol, membership, generatedAt } = gate;
  const canOpenFollowUpWorkflow = !membershipBusyState && !followUpBusyState;
  if (followUpBusyState || followUpWorkflow.state === "loading") {
    return selectedCandidateFollowUpWorkflowBridgeFailure(
      "loading",
      title,
      `Follow-up workflow is loading for ${symbol}; stale local drafts stay hidden until current workflow facts settle.`,
      symbol,
      membership,
      generatedAt,
      followUpWorkflow,
      canOpenFollowUpWorkflow
    );
  }
  if (followUpWorkflow.state === "idle") {
    return selectedCandidateFollowUpWorkflowBridgeFailure(
      "workflow_unloaded",
      title,
      `Follow-up workflow is not loaded for ${symbol}; use the bridge action to read current local workflow facts only.`,
      symbol,
      membership,
      generatedAt,
      followUpWorkflow,
      canOpenFollowUpWorkflow
    );
  }
  const workflowSourceMismatch = selectedCandidateSourceIdentityMismatch(membership, followUpWorkflow);
  if (workflowSourceMismatch) {
    return selectedCandidateFollowUpWorkflowBridgeFailure(
      "source_mismatch",
      title,
      `Fail-closed follow-up mismatch: selected ${membership.symbol}/${membership.id} differs from workflow ${followUpWorkflow.symbol ?? "unloaded"}/${followUpWorkflow.membershipId ?? "unloaded"}; stale local drafts are not trusted.`,
      symbol,
      membership,
      generatedAt,
      followUpWorkflow,
      canOpenFollowUpWorkflow
    );
  }
  if (followUpWorkflow.state !== "available" && followUpWorkflow.state !== "blocked") {
    return selectedCandidateFollowUpWorkflowBridgeFailure(
      followUpWorkflow.state,
      title,
      `Follow-up workflow is ${followUpWorkflow.state}: ${followUpWorkflow.message}`,
      symbol,
      membership,
      generatedAt,
      followUpWorkflow,
      canOpenFollowUpWorkflow
    );
  }
  if (!followUpWorkflow.membershipId || !followUpWorkflow.symbol) {
    return selectedCandidateFollowUpWorkflowBridgeFailure(
      "workflow_unloaded",
      title,
      `Follow-up workflow has no complete source identity for ${symbol}; stale workflow facts are hidden.`,
      symbol,
      membership,
      generatedAt,
      followUpWorkflow,
      canOpenFollowUpWorkflow
    );
  }
  const state = followUpWorkflow.state === "blocked" ? "blocked" : "ready";
  return {
    state,
    title,
    message: state === "ready"
      ? `Selected candidate matches follow-up workflow ${followUpWorkflow.membershipId}; local-only follow-up facts are current for this screen.`
      : `Selected candidate matches a blocked follow-up workflow ${followUpWorkflow.membershipId}; drafts remain bounded by the blocked workspace state.`,
    symbol,
    membershipId: membership.id,
    membershipState: membership.state,
    workflowState: followUpWorkflow.state,
    workflowGeneratedAt: followUpWorkflow.generatedAt,
    canOpenFollowUpWorkflow,
    facts: selectedCandidateFollowUpWorkflowBridgeFacts(membership, followUpWorkflow)
  };
}

function selectedCandidateFollowUpWorkflowBridgeFailure(
  state: SelectedCandidateFollowUpWorkflowBridgeUiState,
  title: string,
  message: string,
  symbol: string | null,
  membership: CandidateMembershipData | null,
  generatedAt: string | null,
  followUpWorkflow: AssistReviewFollowUpWorkflowRenderModel,
  canOpenFollowUpWorkflow = false
): SelectedCandidateFollowUpWorkflowBridgeRenderModel {
  return {
    state,
    title,
    message,
    symbol,
    membershipId: membership?.id ?? null,
    membershipState: membership?.state ?? null,
    workflowState: followUpWorkflow.state,
    workflowGeneratedAt: followUpWorkflow.generatedAt ?? generatedAt,
    canOpenFollowUpWorkflow,
    facts: membership ? [
      `Selected membership: ${membership.symbol}/${membership.id}; state ${membership.state}; version ${membership.version}`,
      `Follow-up workflow state: ${followUpWorkflow.state}; membership ${followUpWorkflow.membershipId ?? "unloaded"}; symbol ${followUpWorkflow.symbol ?? "unloaded"}`,
      "Fail-closed bridge: old follow-up facts are hidden and stale local drafts are not reused across selected-candidate source changes."
    ] : []
  };
}

function selectedCandidateFollowUpWorkflowBridgeFacts(
  membership: CandidateMembershipData,
  followUpWorkflow: AssistReviewFollowUpWorkflowRenderModel
): string[] {
  return [
    `Selected candidate: ${membership.symbol}; membership ${membership.id}; state ${membership.state}; version ${membership.version}`,
    `Follow-up workflow: ${followUpWorkflow.state}; generated ${followUpWorkflow.generatedAt ?? "not generated"}; review state ${followUpWorkflow.reviewState ?? "not loaded"}`,
    `Local workflow facts: ${followUpWorkflow.steps.length} step(s), ${followUpWorkflow.evidenceGaps.length} unresolved gap(s), ${followUpWorkflow.suggestedLocalViews.length} local view(s).`,
    "Bridge is read-only, exact-membership scoped, local-only, not official, not persisted, not sent, and cannot create orders, trades, broker calls, or portfolio facts."
  ];
}

export type SelectedCandidateDecisionNoteWorkflowBridgeUiState =
  | "candidate_missing"
  | "membership_unloaded"
  | "workflow_unloaded"
  | "loading"
  | "ready"
  | "blocked"
  | "source_mismatch"
  | "membership_missing"
  | "unavailable"
  | "unauthorized"
  | "not_found"
  | "malformed"
  | "offline"
  | "conflict"
  | "superseded";

export interface SelectedCandidateDecisionNoteWorkflowBridgeRenderModel {
  state: SelectedCandidateDecisionNoteWorkflowBridgeUiState;
  title: string;
  message: string;
  symbol: string | null;
  membershipId: string | null;
  membershipState: CandidateMembershipData["state"] | null;
  workflowState: AssistDecisionNoteWorkflowUiState | null;
  workflowGeneratedAt: string | null;
  canOpenDecisionNoteWorkflow: boolean;
  facts: string[];
}

export function selectedCandidateDecisionNoteWorkflowBridgeFromState(
  selectedSymbol: string | null,
  memberships: CandidateMembershipRenderModel,
  decisionNoteWorkflow: AssistDecisionNoteWorkflowRenderModel,
  membershipBusyState = false,
  decisionNoteBusyState = false
): SelectedCandidateDecisionNoteWorkflowBridgeRenderModel {
  const gate = resolveSelectedCandidateMembership(
    selectedSymbol,
    memberships,
    membershipBusyState,
    decisionNoteMembershipGateCopy
  );
  if (!gate.ok) {
    return selectedCandidateDecisionNoteWorkflowBridgeFailure(
      gate.state,
      gate.title,
      gate.message,
      gate.symbol,
      null,
      gate.generatedAt,
      decisionNoteWorkflow
    );
  }
  const { title, symbol, membership, generatedAt } = gate;
  const canOpenDecisionNoteWorkflow = !membershipBusyState && !decisionNoteBusyState;
  if (decisionNoteBusyState || decisionNoteWorkflow.state === "loading") {
    return selectedCandidateDecisionNoteWorkflowBridgeFailure(
      "loading",
      title,
      `Decision-note workflow is loading for ${symbol}; stale local drafts stay hidden until current workflow facts settle.`,
      symbol,
      membership,
      generatedAt,
      decisionNoteWorkflow,
      canOpenDecisionNoteWorkflow
    );
  }
  if (decisionNoteWorkflow.state === "idle") {
    return selectedCandidateDecisionNoteWorkflowBridgeFailure(
      "workflow_unloaded",
      title,
      `Decision-note workflow is not loaded for ${symbol}; use the bridge action to read current local workflow facts only.`,
      symbol,
      membership,
      generatedAt,
      decisionNoteWorkflow,
      canOpenDecisionNoteWorkflow
    );
  }
  const workflowSourceMismatch = selectedCandidateSourceIdentityMismatch(membership, decisionNoteWorkflow);
  if (workflowSourceMismatch) {
    return selectedCandidateDecisionNoteWorkflowBridgeFailure(
      "source_mismatch",
      title,
      `Fail-closed decision-note mismatch: selected ${membership.symbol}/${membership.id} differs from workflow ${decisionNoteWorkflow.symbol ?? "unloaded"}/${decisionNoteWorkflow.membershipId ?? "unloaded"}; stale local drafts and local records are not trusted.`,
      symbol,
      membership,
      generatedAt,
      decisionNoteWorkflow,
      canOpenDecisionNoteWorkflow
    );
  }
  if (decisionNoteWorkflow.state !== "available" && decisionNoteWorkflow.state !== "blocked") {
    return selectedCandidateDecisionNoteWorkflowBridgeFailure(
      decisionNoteWorkflow.state,
      title,
      `Decision-note workflow is ${decisionNoteWorkflow.state}: ${decisionNoteWorkflow.message}`,
      symbol,
      membership,
      generatedAt,
      decisionNoteWorkflow,
      canOpenDecisionNoteWorkflow
    );
  }
  if (!decisionNoteWorkflow.membershipId || !decisionNoteWorkflow.symbol) {
    return selectedCandidateDecisionNoteWorkflowBridgeFailure(
      "workflow_unloaded",
      title,
      `Decision-note workflow has no complete source identity for ${symbol}; stale workflow facts are hidden.`,
      symbol,
      membership,
      generatedAt,
      decisionNoteWorkflow,
      canOpenDecisionNoteWorkflow
    );
  }
  const state = decisionNoteWorkflow.state === "blocked" ? "blocked" : "ready";
  return {
    state,
    title,
    message: state === "ready"
      ? `Selected candidate matches decision-note workflow ${decisionNoteWorkflow.membershipId}; local-only decision-note facts are current for this screen.`
      : `Selected candidate matches a blocked decision-note workflow ${decisionNoteWorkflow.membershipId}; drafts remain bounded by the blocked follow-up state.`,
    symbol,
    membershipId: membership.id,
    membershipState: membership.state,
    workflowState: decisionNoteWorkflow.state,
    workflowGeneratedAt: decisionNoteWorkflow.generatedAt,
    canOpenDecisionNoteWorkflow,
    facts: selectedCandidateDecisionNoteWorkflowBridgeFacts(membership, decisionNoteWorkflow)
  };
}

function selectedCandidateDecisionNoteWorkflowBridgeFailure(
  state: SelectedCandidateDecisionNoteWorkflowBridgeUiState,
  title: string,
  message: string,
  symbol: string | null,
  membership: CandidateMembershipData | null,
  generatedAt: string | null,
  decisionNoteWorkflow: AssistDecisionNoteWorkflowRenderModel,
  canOpenDecisionNoteWorkflow = false
): SelectedCandidateDecisionNoteWorkflowBridgeRenderModel {
  return {
    state,
    title,
    message,
    symbol,
    membershipId: membership?.id ?? null,
    membershipState: membership?.state ?? null,
    workflowState: decisionNoteWorkflow.state,
    workflowGeneratedAt: decisionNoteWorkflow.generatedAt ?? generatedAt,
    canOpenDecisionNoteWorkflow,
    facts: membership ? [
      `Selected membership: ${membership.symbol}/${membership.id}; state ${membership.state}; version ${membership.version}`,
      `Decision-note workflow state: ${decisionNoteWorkflow.state}; membership ${decisionNoteWorkflow.membershipId ?? "unloaded"}; symbol ${decisionNoteWorkflow.symbol ?? "unloaded"}`,
      "Fail-closed bridge: old decision-note facts are hidden and stale local drafts or local records are not reused across selected-candidate source changes."
    ] : []
  };
}

function selectedCandidateDecisionNoteWorkflowBridgeFacts(
  membership: CandidateMembershipData,
  decisionNoteWorkflow: AssistDecisionNoteWorkflowRenderModel
): string[] {
  return [
    `Selected candidate: ${membership.symbol}; membership ${membership.id}; state ${membership.state}; version ${membership.version}`,
    `Decision-note workflow: ${decisionNoteWorkflow.state}; generated ${decisionNoteWorkflow.generatedAt ?? "not generated"}; note state ${decisionNoteWorkflow.noteState ?? "not loaded"}`,
    `Local workflow facts: ${decisionNoteWorkflow.factReferences.length} fact reference(s), ${decisionNoteWorkflow.unresolvedEvidenceGaps.length} unresolved gap(s), ${decisionNoteWorkflow.laterReviewEntry.length} later-review marker(s).`,
    "Bridge is read-only, exact-membership scoped, local-only, not official, not persisted, not sent, and cannot create orders, trades, broker calls, local-record authority, or portfolio facts."
  ];
}
