import type { CoreJourneyData } from "./coreJourneyState.js";
import type { DecisionQuantEvidence } from "../../../packages/contracts/src/decisionContextBrowser.js";
import type { CandidateMembershipRenderModel } from "./candidateMembershipState.js";
import type { CandidateDecisionIntakeRenderModel } from "./candidateDecisionIntakeState.js";
import type { AssistAdvisoryScopeRenderModel } from "./assistAdvisoryScopeState.js";
import type { AssistHumanReviewWorkspaceRenderModel } from "./assistHumanReviewWorkspaceState.js";
import type { AssistReviewFollowUpWorkflowRenderModel } from "./assistReviewFollowUpWorkflowState.js";
import type { AssistDecisionNoteWorkflowRenderModel } from "./assistDecisionNoteWorkflowState.js";
import { renderList } from "./domRender.js";
import { selectedCandidateDecisionBridgeFromState } from "./selectedCandidateDecisionBridge.js";
import {
  selectedCandidateAdvisoryScopeBridgeFromState,
  selectedCandidateDecisionContextBridgeFromState,
  selectedCandidateDecisionNoteWorkflowBridgeFromState,
  selectedCandidateFollowUpWorkflowBridgeFromState,
  selectedCandidateHumanReviewWorkspaceBridgeFromState
} from "./selectedCandidateWorkflowBridges.js";

export interface CoreAssistCapabilityConsoleRenderContext {
  data: CoreJourneyData | null;
  busy: boolean;
  candidateMemberships: CandidateMembershipRenderModel;
  decisionIntake: CandidateDecisionIntakeRenderModel;
  membershipBusy: boolean;
  assistAdvisoryScope: AssistAdvisoryScopeRenderModel;
  assistAdvisoryScopeBusy: boolean;
  assistHumanReviewWorkspace: AssistHumanReviewWorkspaceRenderModel;
  assistHumanReviewWorkspaceBusy: boolean;
  assistReviewFollowUpWorkflow: AssistReviewFollowUpWorkflowRenderModel;
  assistReviewFollowUpWorkflowBusy: boolean;
  assistDecisionNoteWorkflow: AssistDecisionNoteWorkflowRenderModel;
  assistDecisionNoteWorkflowBusy: boolean;
  assistLocalRecordStatus: string;
  assistLocalRecordSourceSignatureAvailable: boolean;
  assistLocalRecordSnapshotSummaryLength: number;
  assistReviewKnowledgeStatus: string;
  assistReviewKnowledgeLoadedSymbol: string | null;
  assistReviewKnowledgeEntriesLength: number;
  assistReviewKnowledgeSelectedIdPresent: boolean;
}

export function renderCoreAssistWebCapabilityConsoleHardeningPanel(context: CoreAssistCapabilityConsoleRenderContext): void {
  const {
    data, busy, candidateMemberships, decisionIntake, membershipBusy, assistAdvisoryScope, assistAdvisoryScopeBusy,
    assistHumanReviewWorkspace, assistHumanReviewWorkspaceBusy, assistReviewFollowUpWorkflow,
    assistReviewFollowUpWorkflowBusy, assistDecisionNoteWorkflow, assistDecisionNoteWorkflowBusy,
    assistLocalRecordStatus, assistLocalRecordSourceSignatureAvailable, assistLocalRecordSnapshotSummaryLength,
    assistReviewKnowledgeStatus, assistReviewKnowledgeLoadedSymbol, assistReviewKnowledgeEntriesLength,
    assistReviewKnowledgeSelectedIdPresent
  } = context;
  if (typeof document === "undefined") return;
  ensureCoreAssistWebCapabilityConsoleHardeningPanel();
  const section = document.getElementById("core-assist-web-capability-console-hardening");
  const moduleStatus = document.getElementById("core-assist-web-console-module-status-dashboard");
  const sourceAuthority = document.getElementById("core-assist-web-console-source-authority-ledger");
  const candidateWorkflow = document.getElementById("core-assist-web-console-candidate-workflow-status");
  const localRecords = document.getElementById("core-assist-web-console-local-records-status");
  const portfolioSource = document.getElementById("core-assist-web-console-portfolio-source-status");
  const portfolioAuthorityMatrix = document.getElementById("core-assist-portfolio-historical-authority-boundary-matrix");
  const factMetadataAuthority = document.getElementById("core-assist-facts-metadata-authority-ledger");
  const failureStates = document.getElementById("core-assist-web-console-failure-state-board");
  const releaseReadiness = document.getElementById("core-assist-web-console-release-readiness-board");
  const releaseBlockers = document.getElementById("core-assist-web-console-release-blocker-status-matrix");
  const platformReliability = document.getElementById("core-assist-platform-reliability-readiness-matrix");
  const productionAssessment = document.getElementById("core-assist-production-assessment-preparation-board");
  const quantReadiness = document.getElementById("core-assist-web-console-quant-readiness-board");
  const environmentBoundary = document.getElementById("core-assist-web-console-environment-boundary-board");
  const requiredOutputEvidence = document.getElementById("core-assist-web-console-required-output-evidence-ledger");
  const safety = document.getElementById("core-assist-web-console-safety-boundary");
  if (
    !section || !moduleStatus || !sourceAuthority || !candidateWorkflow || !localRecords
    || !portfolioSource || !portfolioAuthorityMatrix || !factMetadataAuthority || !failureStates || !releaseReadiness || !platformReliability || !productionAssessment || !quantReadiness
    || !releaseBlockers || !environmentBoundary || !requiredOutputEvidence || !safety
  ) return;

  const selectedSymbol = data?.symbol.symbol ?? null;
  const decisionBridge = selectedCandidateDecisionBridgeFromState(selectedSymbol, candidateMemberships, membershipBusy);
  const decisionContextBridge = selectedCandidateDecisionContextBridgeFromState(
    selectedSymbol,
    candidateMemberships,
    data?.decisionContext ?? null,
    membershipBusy,
    busy
  );
  const advisoryBridge = selectedCandidateAdvisoryScopeBridgeFromState(
    selectedSymbol,
    candidateMemberships,
    assistAdvisoryScope,
    membershipBusy,
    assistAdvisoryScopeBusy
  );
  const humanReviewBridge = selectedCandidateHumanReviewWorkspaceBridgeFromState(
    selectedSymbol,
    candidateMemberships,
    assistHumanReviewWorkspace,
    membershipBusy,
    assistHumanReviewWorkspaceBusy
  );
  const followUpBridge = selectedCandidateFollowUpWorkflowBridgeFromState(
    selectedSymbol,
    candidateMemberships,
    assistReviewFollowUpWorkflow,
    membershipBusy,
    assistReviewFollowUpWorkflowBusy
  );
  const decisionNoteBridge = selectedCandidateDecisionNoteWorkflowBridgeFromState(
    selectedSymbol,
    candidateMemberships,
    assistDecisionNoteWorkflow,
    membershipBusy,
    assistDecisionNoteWorkflowBusy
  );

  section.setAttribute("data-state", "core_assist_web_capability_console_hardening");
  section.setAttribute("data-accepted-task", "CORE-ASSIST-WEB-CAPABILITY-CONSOLE-HARDENING-1");
  section.setAttribute("data-task-closeout", "accepted_repository_local");
  section.setAttribute("data-next-local-task", "none");
  section.setAttribute("data-next-governance-task", "FULL-PROJECT-DEFERRED-GITHUB-SUBMISSION-1");
  section.setAttribute("data-next-boundary", "CORE-1B-LIVE-CURRENT-SOURCE");
  section.setAttribute("data-current-authority-boundary-task", "CORE-1B-LIVE-CURRENT-SOURCE");
  section.setAttribute("data-local-validation", "COMPLETED");
  section.setAttribute("data-github-submission", "READY_NOT_STARTED");
  section.setAttribute("data-console-role", "capability_console");
  section.setAttribute("data-trading-terminal", "false");
  section.setAttribute("data-environment-boundary", "fixture_local_staging_production_separated");
  section.setAttribute("data-production", "NO_GO");
  section.setAttribute("data-staging", "READONLY_CANDIDATE_RELEASED");
  section.setAttribute("data-quant", "RESEARCH_EVIDENCE_ONLY");
  section.setAttribute("data-portfolio-authority", "omitted_or_historical_only");
  section.setAttribute("data-ios-physical-device", "OWNER_WAIVED_NONBLOCKING_FAILURE");
  section.setAttribute("data-broker-write", "NOT_USED");
  section.setAttribute("data-official-portfolio-mutation", "NOT_USED");
  section.setAttribute("data-release-blocker-matrix", "visible");
  section.setAttribute("data-release-blocker-production", "NO_GO");
  section.setAttribute("data-release-blocker-staging", "READONLY_RELEASE_COMPLETED");
  section.setAttribute("data-release-blocker-ios-device", "OWNER_WAIVED_NONBLOCKING_FAILURE");
  section.setAttribute("data-release-blocker-broker-write", "NOT_USED");
  section.setAttribute("data-release-blocker-portfolio-source", "BLOCKED_NO_APPROVED_LIVE_AUTHORITY");
  section.setAttribute("data-release-blocker-pingan-source", "HISTORICAL_OR_LAST_IMPORTED_ONLY");
  section.setAttribute("data-release-blocker-quant", "RESEARCH_EVIDENCE_ONLY");
  section.setAttribute("data-release-blocker-automation", "FROZEN");
  section.setAttribute("data-release-blocker-auto-merge", "FORBIDDEN");
  section.setAttribute("data-required-output-evidence-ledger", "visible");
  section.setAttribute("data-facts-metadata-authority-ledger", "visible");
  section.setAttribute("data-platform-reliability-readiness", "visible");
  section.setAttribute("data-production-assessment", "accepted_repository_local_no_go_blockers");
  section.setAttribute("data-production-assessment-command", "production_readiness_assessment_preparation");
  section.setAttribute("data-production-assessment-checklist", "readonly_candidate_completed_full_production_blocked");
  section.setAttribute("data-production-assessment-owner-authorization", "required_before_full_production_promotion");
  section.setAttribute("data-production-assessment-no-write", "true");
  section.setAttribute("data-quant-snapshot-readiness", "fixture_frozen_snapshot_foundation");
  section.setAttribute("data-quant-snapshot-verify-command", "quant_freeze_snapshot_verify");
  section.setAttribute("data-quant-snapshot-source-classification", "fixture");
  section.setAttribute("data-quant-snapshot-authority", "research_only");
  section.setAttribute("data-quant-baseline-readiness", "sample_split_baseline_research_only");
  section.setAttribute("data-quant-baseline-command", "quant_sample_split_baseline");
  section.setAttribute("data-quant-baseline-final-test", "locked_report_only_no_tuning");
  section.setAttribute("data-quant-baseline-authority", "research_evidence_only");
  section.setAttribute("data-quant-shadow-status", "isolated_shadow_portfolio_research_only");
  section.setAttribute("data-quant-shadow-command", "quant_shadow_portfolio");
  section.setAttribute("data-quant-shadow-authority", "research_only_simulation");
  section.setAttribute("data-quant-shadow-official-facts", "false");
  section.setAttribute("data-readonly-api-mode", "fail_closed_required");
  section.setAttribute("data-live-smoke-scope", "GET_ONLY");
  section.setAttribute("data-db-readonly-denial", "verified_sqlstate_25006");
  section.setAttribute("data-rollback-recovery-evidence", "verified_backup_restore_rollback");
  section.setAttribute("data-readonly-release", "COMPLETED");
  section.setAttribute("data-readonly-release-head", "f78ef83fbfc0096444d9996ec06c2b51efda5755");
  section.setAttribute("data-readonly-release-merge", "6218c504f12126be71769b21fd5b17bc356a2e45");
  section.setAttribute("data-production-get-smoke", "VERIFIED_GET_ONLY");
  section.setAttribute("data-tls-hostname-validation", "KNOWN_MISMATCH_NOT_CLAIMED");
  section.setAttribute("data-observability-health-reporting", "mainline_health_dry_run_only");
  section.setAttribute("data-observability-release-blocker-report", "mainline_health_report_ledger");
  section.setAttribute("data-platform-reliability-ledger-command", "platform_reliability_ledger");
  section.setAttribute("data-platform-release-evidence-register-command", "platform_release_evidence_register");

  renderList(moduleStatus, [
    "Accepted task: CORE-ASSIST-WEB-CAPABILITY-CONSOLE-HARDENING-1; Web role is capability inspection, source audit, release-blocker visibility, and local beta verification.",
    "Accepted task: QUANT-1D-READ-ONLY-RESEARCH-EVIDENCE-INTEGRATION-1; accepted quant outputs are labelled read-only research evidence with identity, limitations, sample boundary, staleness, and no ordering, review, portfolio, broker, accounting, cash, fee, position, order, trade, or production authority.",
    "Accepted task: ASSIST-1-LOCAL-REVIEW-KNOWLEDGE-LOOP-1; source-scoped Web/iOS local retrospective knowledge is complete. The reviewed read-only candidate release is also complete; the remaining authority boundary is CORE-1B-LIVE-CURRENT-SOURCE.",
    `Module states: candidateMemberships=${candidateMemberships.state}; selectedCandidate=${decisionBridge.state}; decisionContext=${decisionContextBridge.state}; advisoryScope=${advisoryBridge.state}; humanReviewWorkspace=${humanReviewBridge.state}; followUpWorkflow=${followUpBridge.state}; decisionNoteWorkflow=${decisionNoteBridge.state}; localRecords=${assistLocalRecordStatus}.`,
    `Current source focus: symbol=${selectedSymbol ?? "not_selected"}; membershipGeneratedAt=${candidateMemberships.generatedAt ?? "not_loaded"}; actionState=${candidateMemberships.action.state}; busy=${busy || membershipBusy || assistAdvisoryScopeBusy || assistHumanReviewWorkspaceBusy || assistReviewFollowUpWorkflowBusy || assistDecisionNoteWorkflowBusy}.`,
    "Operator interpretation: every status row is a capability signal with source context; it is not a security-selection, portfolio-action, account-operation, or execution surface."
  ], "CORE-ASSIST Web capability module status is unavailable.");
  renderList(sourceAuthority, [
    "Candidate source authority: candidate membership facts come from the authenticated candidate-memberships envelope or an explicit fail-closed state; missing facts are not filled by defaults.",
    "Quote and research authority: decision context keeps quote freshness, research evidence provenance, source/as-of/fetched metadata, stale states, missing states, and conflict states visible before local review.",
    "Human-review authority: submitted checks and review history stay append-only, idempotent, and context-bound; local drafts never become official review facts.",
    "Environment authority: fixture facts, browser-local state, iOS UserDefaults state, the completed read-only candidate release, and full-production NO_GO are separate lanes with visible source labels."
  ], "CORE-ASSIST Web capability source authority is unavailable.");
  renderList(candidateWorkflow, [
    "Candidate workflow status: candidate overview -> selected membership -> decision intake -> decision context -> advisory scope -> human-review workspace -> local record -> review history -> follow-up workflow -> decision-note workflow.",
    `Current workflow lane states: intake=${decisionBridge.state}; context=${decisionContextBridge.state}; advisory=${advisoryBridge.state}; humanReview=${humanReviewBridge.state}; followUp=${followUpBridge.state}; decisionNote=${decisionNoteBridge.state}.`,
    "Workflow guard: no-selected-candidate, membership-unloaded, source-mismatch, archived, stale, missing, unauthorized, conflict, offline, malformed, and unavailable lanes hide stale downstream success.",
    "Operator action boundary: console rows can explain what is loaded, blocked, stale, or missing; they do not create portfolio instructions or account actions."
  ], "CORE-ASSIST Web capability candidate workflow is unavailable.");
  renderList(localRecords, [
    `Local records status: state=${assistLocalRecordStatus}; currentSourceSignature=${assistLocalRecordSourceSignatureAvailable ? "available" : "unavailable"}; snapshotSummaryItems=${assistLocalRecordSnapshotSummaryLength}.`,
    `Retrospective knowledge status: state=${assistReviewKnowledgeStatus}; loadedSymbol=${assistReviewKnowledgeLoadedSymbol ?? "not_loaded"}; entries=${assistReviewKnowledgeEntriesLength}; selectedEntry=${assistReviewKnowledgeSelectedIdPresent ? "present" : "none"}.`,
    "Retrospective knowledge entries are immutable browser-local history: current-source, historical-source, and source-unavailable classifications stay distinct, and corrections append lineage instead of overwriting older entries.",
    "Browser localStorage and iOS UserDefaults records remain source-scoped unofficial local thoughts only; local drafts remain volatile memory state until explicitly saved in the current client.",
    "Mismatch, malformed, missing snapshot authority, stale source, unauthorized source, offline source, conflict, unavailable source, and source-change states hide saved records and clear stale local display.",
    "Local records are not uploaded, not database-written, not broker-synced, not official review history, and not portfolio facts."
  ], "CORE-ASSIST Web capability local record status is unavailable.");
  renderList(portfolioSource, [
    "Portfolio source boundary: this task includes no approved live authoritative portfolio source; portfolio context remains omitted.",
    "Pingan source status: historical-only or last-imported context with source, as-of, imported-at, fetched-at, freshness, stale warning, and not-live authority.",
    "Portfolio risk boundary: stale or historical-only Pingan snapshot rows cannot become live risk impact, broker reconciliation, account truth, or execution/accounting authority.",
    "Fixture and research data boundary: sample, migration, fixture, shadow, research, and quant evidence are never displayed as real holdings."
  ], "CORE-ASSIST Web capability portfolio source status is unavailable.");
  renderEvidenceLedger(portfolioAuthorityMatrix, [
    {
      id: "core-assist-portfolio-authority-omitted-live-source",
      text: "Portfolio omitted boundary: no approved live authoritative portfolio source exists, so portfolio context is omitted and cannot imply current holdings.",
      authority: "none_approved_live_source",
      freshness: "not_applicable",
      provenance: "omitted",
      environment: "local",
      staleSuccess: "blocked",
      officialFact: "false"
    },
    {
      id: "core-assist-pingan-authority-historical-only",
      text: "Pingan historical boundary: Pingan may be shown only as historical or last-imported with source, sourceSnapshotId, as-of, imported-at, fetched-at, freshness, and warning metadata.",
      authority: "historical_only",
      freshness: "historical_or_stale_visible",
      provenance: "pingan_imported_snapshot",
      environment: "local",
      staleSuccess: "blocked",
      officialFact: "false"
    },
    {
      id: "core-assist-pingan-authority-no-risk-impact",
      text: "Pingan risk boundary: historical rows are not live holdings and cannot become risk-impact authority, broker reconciliation, account truth, accounting authority, or execution input.",
      authority: "not_live_authoritative",
      freshness: "historical_or_stale_visible",
      provenance: "visible",
      environment: "local",
      staleSuccess: "blocked",
      officialFact: "false"
    },
    {
      id: "core-assist-portfolio-pingan-failure-state-boundary",
      text: "Portfolio/Pingan failure boundary: conflict, missing, stale, unauthorized, unavailable, offline, malformed, fixture-unavailable, and source-mismatch states remain visible and fail closed.",
      authority: "fail_closed",
      freshness: "not_fresh",
      provenance: "visible",
      environment: "local",
      staleSuccess: "blocked",
      officialFact: "false"
    },
    {
      id: "core-assist-portfolio-failure-loading-empty-stale",
      text: "Portfolio failure states loading, empty, and stale are explicit: loading waits for current source identity, empty means no approved historical row, and stale remains labelled stale or historical.",
      authority: "fail_closed",
      freshness: "not_fresh",
      provenance: "visible",
      environment: "local",
      staleSuccess: "blocked",
      officialFact: "false"
    },
    {
      id: "core-assist-portfolio-failure-unauthorized-conflict-unavailable",
      text: "Portfolio failure states unauthorized, conflict, and unavailable expose no positions and must not be rendered as empty success or live holdings.",
      authority: "fail_closed",
      freshness: "not_fresh",
      provenance: "visible",
      environment: "local",
      staleSuccess: "blocked",
      officialFact: "false"
    },
    {
      id: "core-assist-portfolio-failure-offline-malformed-fixture-unavailable",
      text: "Portfolio failure states offline, malformed, and fixture-unavailable keep local-only or fixture boundaries visible and never promote sample data to real holdings.",
      authority: "fail_closed",
      freshness: "not_fresh",
      provenance: "visible",
      environment: "local",
      staleSuccess: "blocked",
      officialFact: "false"
    },
    {
      id: "core-assist-portfolio-failure-source-mismatch-missing",
      text: "Portfolio source-mismatch and missing states hide source-scoped records and historical rows until selected candidate, membership, workflow, quote, research, and source signatures match.",
      authority: "fail_closed",
      freshness: "not_fresh",
      provenance: "visible",
      environment: "local",
      staleSuccess: "blocked",
      officialFact: "false"
    },
    {
      id: "core-assist-portfolio-source-class-sample-fixture-migration-shadow",
      text: "Portfolio source classes sample, fixture, migration, and shadow are blocked from real-holdings display and cannot become broker truth, account truth, accounting authority, or execution input.",
      authority: "not_approved_source_class",
      freshness: "not_applicable",
      provenance: "visible",
      environment: "local",
      staleSuccess: "blocked",
      officialFact: "false"
    },
    {
      id: "core-assist-portfolio-source-class-research-quant-local",
      text: "Research evidence, quant evidence, local records, decision notes, and review history remain non-mutating context only and cannot enter official portfolio facts.",
      authority: "research_or_local_only",
      freshness: "not_applicable",
      provenance: "visible",
      environment: "local",
      staleSuccess: "blocked",
      officialFact: "false"
    },
    {
      id: "core-assist-portfolio-non-mutation-boundary",
      text: "Non-mutation boundary: local records, decision notes, review history, research, and quant evidence do not mutate official portfolio, cash, fee, position, transaction, or review facts.",
      authority: "non_mutating",
      freshness: "not_applicable",
      provenance: "visible",
      environment: "local",
      staleSuccess: "blocked",
      officialFact: "false"
    }
  ], "CORE-ASSIST portfolio historical authority boundary matrix is unavailable.");
  const reviewHistoryMetadata = data?.reviewHistory?.metadata ?? null;
  const candidateMembershipMetadata = candidateMemberships.metadata;
  const candidateMetadataState = candidateMembershipMetadata
    ? candidateMemberships.state === "available" || candidateMemberships.state === "empty"
      ? candidateMemberships.state
      : `blocked:${candidateMemberships.state}`
    : candidateMemberships.state === "idle"
      ? "missing:not-loaded"
      : `blocked:${candidateMemberships.state}`;
  const candidateMetadataConflict = Boolean(candidateMembershipMetadata?.conflict || candidateMemberships.state === "conflict");
  const candidateMetadataText = candidateMembershipMetadata
    ? `Candidate membership fact metadata: source=${candidateMembershipMetadata.source}; as-of=${candidateMembershipMetadata.asOf ?? "missing"}; fetched-at=${candidateMembershipMetadata.fetchedAt ?? "missing"}; freshness=${candidateMembershipMetadata.freshness}; provenance=${candidateMembershipMetadata.provenance}; authority=${candidateMembershipMetadata.authority}; state=${candidateMetadataState}; symbol=${selectedSymbol ?? "missing:not-selected"}; flags=stale:${candidateMembershipMetadata.stale},missing:${candidateMembershipMetadata.missing},conflict:${candidateMetadataConflict},fixture:${candidateMembershipMetadata.fixture}; correctionOf=${candidateMembershipMetadata.correctionOf ?? "none"}; replaces=${candidateMembershipMetadata.replaces ?? "none"}; selected candidate membership context only, not a ranking, recommendation, portfolio fact, broker fact, cash, fee, position, transaction, or trading authority.`
    : `Candidate membership fact metadata: source=missing:not-loaded; as-of=missing:not-loaded; fetched-at=missing:not-loaded; freshness=missing:not-loaded; provenance=missing:not-loaded; authority=candidate_membership; state=${candidateMetadataState}; symbol=${selectedSymbol ?? "missing:not-selected"}; flags=stale:false,missing:true,conflict:false,fixture:false; correctionOf=none; replaces=none; no stale candidate membership facts are reused.`;
  const decisionIntakeMetadata = decisionIntake.metadata;
  const decisionIntakeSourceMismatch = Boolean(
    decisionIntake.symbol && selectedSymbol && decisionIntake.symbol !== selectedSymbol
  );
  const decisionIntakeMetadataState = decisionIntakeMetadata
    ? decisionIntakeSourceMismatch
      ? "blocked:source-mismatch"
      : decisionIntake.state
    : decisionIntake.state === "idle"
      ? "missing:not-loaded"
      : `blocked:${decisionIntake.state}`;
  const decisionIntakeMetadataConflict = Boolean(decisionIntakeMetadata?.conflict || decisionIntakeSourceMismatch || decisionIntake.state === "conflict");
  const decisionIntakeMetadataText = decisionIntakeMetadata
    ? `Decision-intake fact metadata: source=${decisionIntakeMetadata.source}; as-of=${decisionIntakeMetadata.asOf ?? "missing"}; fetched-at=${decisionIntakeMetadata.fetchedAt ?? "missing"}; freshness=${decisionIntakeMetadata.freshness}; provenance=${decisionIntakeMetadata.provenance}; authority=${decisionIntakeMetadata.authority}; state=${decisionIntakeMetadataState}; symbol=${decisionIntake.symbol ?? "missing"}; flags=stale:${decisionIntakeMetadata.stale},missing:${decisionIntakeMetadata.missing},conflict:${decisionIntakeMetadataConflict},fixture:${decisionIntakeMetadata.fixture}; correctionOf=${decisionIntakeMetadata.correctionOf ?? "none"}; replaces=${decisionIntakeMetadata.replaces ?? "none"}; decision-intake context only, not an official review, ranking, recommendation, order, trade, fill, cash, fee, position, portfolio mutation, or broker authority.`
    : `Decision-intake fact metadata: source=missing:not-loaded; as-of=missing:not-loaded; fetched-at=missing:not-loaded; freshness=missing:not-loaded; provenance=missing:not-loaded; authority=decision_context; state=${decisionIntakeMetadataState}; symbol=${selectedSymbol ?? "missing:not-selected"}; flags=stale:false,missing:true,conflict:false,fixture:false; correctionOf=none; replaces=none; no stale decision-intake facts are reused.`;
  const currentDecisionContext = data?.decisionContext ?? null;
  const quoteMetadata = currentDecisionContext?.quote.metadata ?? null;
  const quoteSourceMismatch = Boolean(
    currentDecisionContext && selectedSymbol && currentDecisionContext.requestedSymbol !== selectedSymbol
  );
  const quoteMetadataState = quoteMetadata
    ? quoteSourceMismatch
      ? "blocked:source-mismatch"
      : currentDecisionContext?.quote.status ?? "blocked:missing-quote"
    : currentDecisionContext
      ? "blocked:missing-metadata"
      : "missing:not-loaded";
  const quoteMetadataConflict = Boolean(quoteMetadata?.conflict || quoteSourceMismatch || decisionContextBridge.state === "source_mismatch");
  const quoteMetadataText = quoteMetadata && currentDecisionContext
    ? `Quote fact metadata: source=${quoteMetadata.source}; as-of=${quoteMetadata.asOf ?? currentDecisionContext.quote.data?.quoteTime ?? "missing"}; fetched-at=${quoteMetadata.fetchedAt ?? currentDecisionContext.quote.fetchedAt ?? "missing"}; freshness=${quoteMetadata.freshness}; provenance=${quoteMetadata.provenance}; authority=${quoteMetadata.authority}; state=${quoteMetadataState}; symbol=${currentDecisionContext.quote.data?.symbol ?? currentDecisionContext.requestedSymbol}; flags=stale:${quoteMetadata.stale},missing:${quoteMetadata.missing},conflict:${quoteMetadataConflict},fixture:${quoteMetadata.fixture}; correctionOf=${quoteMetadata.correctionOf ?? "none"}; replaces=${quoteMetadata.replaces ?? "none"}; market quote context only, not portfolio, broker, cash, fee, position, transaction, ranking, recommendation, order, trade, or allocation authority.`
    : `Quote fact metadata: source=missing:not-loaded; as-of=missing:not-loaded; fetched-at=missing:not-loaded; freshness=missing:not-loaded; provenance=missing:not-loaded; authority=market_quote_context_only; state=${quoteMetadataState}; symbol=${selectedSymbol ?? "missing:not-selected"}; flags=stale:false,missing:true,conflict:false,fixture:false; correctionOf=none; replaces=none; no stale quote facts are reused or filled by defaults.`;
  const researchMetadata = currentDecisionContext?.research.metadata ?? null;
  const researchSourceMismatch = Boolean(
    currentDecisionContext && selectedSymbol && currentDecisionContext.requestedSymbol !== selectedSymbol
  );
  const researchMetadataState = researchMetadata
    ? researchSourceMismatch
      ? "blocked:source-mismatch"
      : currentDecisionContext?.research.status ?? "blocked:missing-research"
    : currentDecisionContext
      ? "blocked:missing-metadata"
      : "missing:not-loaded";
  const researchMetadataConflict = Boolean(researchMetadata?.conflict || researchSourceMismatch || decisionContextBridge.state === "source_mismatch");
  const researchMetadataText = researchMetadata && currentDecisionContext
    ? `Research fact metadata: source=${researchMetadata.source}; as-of=${researchMetadata.asOf ?? currentDecisionContext.research.evidenceAsOf ?? "missing"}; fetched-at=${researchMetadata.fetchedAt ?? currentDecisionContext.research.evidenceAsOf ?? "missing:not-provided-by-contract"}; freshness=${researchMetadata.freshness}; provenance=${researchMetadata.provenance}; authority=${researchMetadata.authority}; state=${researchMetadataState}; symbol=${currentDecisionContext.research.profile?.symbol ?? currentDecisionContext.requestedSymbol}; flags=stale:${researchMetadata.stale},missing:${researchMetadata.missing},conflict:${researchMetadataConflict},fixture:${researchMetadata.fixture}; correctionOf=${researchMetadata.correctionOf ?? "none"}; replaces=${researchMetadata.replaces ?? "none"}; research evidence only, not advice, not ranking, not recommendation, not portfolio, broker, cash, fee, position, transaction, order, trade, or allocation authority.`
    : `Research fact metadata: source=missing:not-loaded; as-of=missing:not-loaded; fetched-at=missing:not-loaded; freshness=missing:not-loaded; provenance=missing:not-loaded; authority=research_evidence_only; state=${researchMetadataState}; symbol=${selectedSymbol ?? "missing:not-selected"}; flags=stale:false,missing:true,conflict:false,fixture:false; correctionOf=none; replaces=none; missing research facts are not fabricated or filled by defaults.`;
  const decisionContextState = currentDecisionContext
    ? decisionContextBridge.state === "ready"
      ? "available:source-scoped-current"
      : `blocked:${decisionContextBridge.state}`
    : "missing:not-loaded";
  const decisionContextConflict = Boolean(quoteSourceMismatch || researchSourceMismatch || decisionContextBridge.state === "source_mismatch");
  const decisionContextText = currentDecisionContext
    ? `Decision-context fact metadata: source=decision_context_envelope; as-of=${currentDecisionContext.generatedAt}; fetched-at=missing:not-provided-by-contract; freshness=${decisionContextBridge.state === "ready" ? "source-scoped-current" : "blocked:not-fresh"}; provenance=quote:${currentDecisionContext.provenance.quote},research:${currentDecisionContext.provenance.research},portfolio:${currentDecisionContext.provenance.portfolio}; authority=decision_context_facts_only; state=${decisionContextState}; symbol=${currentDecisionContext.requestedSymbol}; context=${currentDecisionContext.contextId}; hash=${currentDecisionContext.contextHash}; flags=stale:${decisionContextBridge.state !== "ready"},missing:false,conflict:${decisionContextConflict},fixture:false; correctionOf=none; replaces=none; factual context only, not official review, portfolio, broker, cash, fee, position, transaction, recommendation, ranking, order, trade, sizing, or allocation authority.`
    : `Decision-context fact metadata: source=missing:not-loaded; as-of=missing:not-loaded; fetched-at=missing:not-loaded; freshness=missing:not-loaded; provenance=missing:not-loaded; authority=decision_context_facts_only; state=${decisionContextState}; symbol=${selectedSymbol ?? "missing:not-selected"}; context=missing:not-loaded; hash=missing:not-loaded; flags=stale:false,missing:true,conflict:false,fixture:false; correctionOf=none; replaces=none; missing decision context is not synthesized from defaults.`;
  const reviewHistorySourceMismatch = Boolean(
    data?.reviewHistory && selectedSymbol && data.reviewHistory.requestedSymbol !== selectedSymbol
  );
  const reviewHistoryState = data?.reviewHistory
    ? reviewHistorySourceMismatch
      ? "blocked:source-mismatch"
      : reviewHistoryMetadata?.freshness === "fresh"
        ? "available:append-only-review-history"
        : reviewHistoryMetadata?.freshness === "missing"
          ? "missing:no-recorded-checks"
          : `blocked:${reviewHistoryMetadata?.freshness ?? "unavailable"}`
    : "missing:not-loaded";
  const reviewHistoryConflict = Boolean(reviewHistoryMetadata?.conflict || reviewHistorySourceMismatch);
  const reviewHistoryMetadataText = reviewHistoryMetadata
    ? `Review-history fact metadata: source=${reviewHistoryMetadata.source}; as-of=${reviewHistoryMetadata.asOf ?? "missing"}; fetched-at=${reviewHistoryMetadata.fetchedAt ?? "missing"}; freshness=${reviewHistoryMetadata.freshness}; provenance=${reviewHistoryMetadata.provenance}; authority=${reviewHistoryMetadata.authority}; state=${reviewHistoryState}; symbol=${data?.reviewHistory?.requestedSymbol ?? "missing"}; flags=stale:${reviewHistoryMetadata.stale},missing:${reviewHistoryMetadata.missing},conflict:${reviewHistoryConflict},fixture:${reviewHistoryMetadata.fixture}; correctionOf=${reviewHistoryMetadata.correctionOf ?? "none"}; replaces=${reviewHistoryMetadata.replaces ?? "none"}; append-only advisory context only, not local draft, not official portfolio, not broker, cash, fee, position, transaction, or trading authority.`
    : `Review-history fact metadata: source=missing:not-loaded; as-of=missing:not-loaded; fetched-at=missing:not-loaded; freshness=missing:not-loaded; provenance=missing:not-loaded; authority=decision-context-review-read-only; state=${reviewHistoryState}; symbol=${selectedSymbol ?? "missing:not-selected"}; flags=stale:false,missing:true,conflict:false,fixture:false; correctionOf=none; replaces=none; no stale review facts are reused.`;
  const currentQuantEvidence = currentDecisionContext?.quantEvidence ?? null;
  const quantEvidenceMetadata = currentQuantEvidence?.metadata ?? null;
  const quantEvidenceState = currentQuantEvidence
    ? currentQuantEvidence.status === "available"
      ? "available:decision-context-read-only"
      : `blocked:${currentQuantEvidence.status}`
    : "missing:not-loaded";
  const quantEvidenceSnapshotHash = currentQuantEvidence?.identities?.frozenSnapshot.snapshotHash ?? "missing:not-available";
  const quantEvidenceSampleBoundary = currentQuantEvidence?.sampleBoundary.limitation ?? "missing:not-loaded";
  const quantEvidenceUniverse = currentQuantEvidence?.sampleBoundary.universe.join(",") || "missing:not-loaded";
  const quantEvidenceShadow = currentQuantEvidence?.identities?.shadowPortfolioIdentity ?? "missing:not-available";
  const quantEvidenceHkConnect = quantHkConnectLabel(currentQuantEvidence);
  const quantRefinement = quantRefinementMetadata(currentQuantEvidence);
  const quantEvidenceNoOfficialFacts = Boolean(
    currentQuantEvidence
      && currentQuantEvidence.authority.officialPortfolioFact === false
      && currentQuantEvidence.authority.officialReviewFact === false
      && currentQuantEvidence.authority.brokerWrite === false
      && currentQuantEvidence.authority.changesCandidateOrdering === false
      && currentQuantEvidence.authority.changesHumanReviewResult === false
  );
  const quantEvidenceMetadataText = quantEvidenceMetadata && currentQuantEvidence
    ? `Quant fact metadata: source=${quantEvidenceMetadata.source}; as-of=${quantEvidenceMetadata.asOf ?? "missing"}; fetched-at=${quantEvidenceMetadata.fetchedAt ?? "missing"}; freshness=${quantEvidenceMetadata.freshness}; provenance=${quantEvidenceMetadata.provenance}; authority=${quantEvidenceMetadata.authority}; lane=quant-evidence; state=${quantEvidenceState}; flags=stale:${quantEvidenceMetadata.stale},missing:${quantEvidenceMetadata.missing},conflict:${quantEvidenceMetadata.conflict},fixture:${quantEvidenceMetadata.fixture}; snapshotHash=${quantEvidenceSnapshotHash}; sampleBoundary=${quantEvidenceSampleBoundary}; universe=${quantEvidenceUniverse}; hkConnect=${quantEvidenceHkConnect}; shadow=${quantEvidenceShadow}; refinement=${quantRefinement.state}; refinementId=${quantRefinement.id}; noOfficialFacts=${quantEvidenceNoOfficialFacts}; correctionOf=${quantEvidenceMetadata.correctionOf ?? "none"}; replaces=${quantEvidenceMetadata.replaces ?? "none"}; quant output is labelled read-only research evidence only, not live market data, not a ranking, not a recommendation, not an official review fact, not an official portfolio fact, not broker authority, and not candidate-ordering authority.`
    : `Quant fact metadata: source=missing:not-loaded; as-of=missing:not-loaded; fetched-at=missing:not-loaded; freshness=missing:not-loaded; provenance=quant_evidence; authority=quant_evidence; lane=quant-evidence; state=${quantEvidenceState}; flags=stale:false,missing:true,conflict:false,fixture:false; snapshotHash=missing:not-loaded; sampleBoundary=missing:not-loaded; universe=missing:not-loaded; shadow=missing:not-loaded; noOfficialFacts=true; correctionOf=none; replaces=none; missing quant output is not synthesized from defaults and cannot affect decision context, candidate ordering, review, portfolio, or broker facts.`;
  const stagingReleaseMetadata = {
    source: "docs/audit/READONLY-RELEASE-1.md",
    asOf: "reviewed-head:f78ef83fbfc0096444d9996ec06c2b51efda5755",
    fetchedAt: "2026-07-14T01:05:40Z",
    freshness: "verified:exact-head-read-only-candidate-release",
    provenance: "content_addressed_release_evidence",
    authority: "release_status_only_no_production_promotion",
    state: "completed:read-only-candidate-release:production-NO_GO",
    lane: "read-only-release-production-boundary",
    stale: false,
    missing: false,
    conflict: false,
    fixture: false,
    correctionOf: "none",
    replaces: "none"
  };
  const stagingReleaseMetadataText = `Read-only release fact metadata: source=${stagingReleaseMetadata.source}; as-of=${stagingReleaseMetadata.asOf}; fetched-at=${stagingReleaseMetadata.fetchedAt}; freshness=${stagingReleaseMetadata.freshness}; provenance=${stagingReleaseMetadata.provenance}; authority=${stagingReleaseMetadata.authority}; lane=${stagingReleaseMetadata.lane}; state=${stagingReleaseMetadata.state}; flags=stale:${stagingReleaseMetadata.stale},missing:${stagingReleaseMetadata.missing},conflict:${stagingReleaseMetadata.conflict},fixture:${stagingReleaseMetadata.fixture}; correctionOf=${stagingReleaseMetadata.correctionOf}; replaces=${stagingReleaseMetadata.replaces}; released head f78ef83fbfc0096444d9996ec06c2b51efda5755 has verified exact-head runtime, GET-only smoke, SQLSTATE 25006 denial, backup, isolated restore, rollback, and private ingress evidence; full production remains NO_GO.`;
  renderEvidenceLedger(factMetadataAuthority, [
    {
      id: "core-assist-fact-metadata-candidate",
      text: candidateMetadataText,
      authority: candidateMembershipMetadata?.authority ?? "candidate_membership",
      freshness: candidateMembershipMetadata?.freshness ?? "missing:not-loaded",
      provenance: candidateMembershipMetadata?.provenance ?? "missing:not-loaded",
      environment: candidateMembershipMetadata?.fixture ? "fixture" : "local",
      staleSuccess: "blocked",
      officialFact: "false"
    },
    {
      id: "core-assist-fact-metadata-decision-intake",
      text: decisionIntakeMetadataText,
      authority: decisionIntakeMetadata?.authority ?? "decision_context",
      freshness: decisionIntakeMetadata?.freshness ?? "missing:not-loaded",
      provenance: decisionIntakeMetadata?.provenance ?? "missing:not-loaded",
      environment: decisionIntakeMetadata?.fixture ? "fixture" : "local",
      staleSuccess: "blocked",
      officialFact: "false"
    },
    {
      id: "core-assist-fact-metadata-quote",
      text: quoteMetadataText,
      authority: quoteMetadata?.authority ?? "market_quote_context_only",
      freshness: quoteMetadata?.freshness ?? "missing:not-loaded",
      provenance: quoteMetadata?.provenance ?? "missing:not-loaded",
      environment: quoteMetadata?.fixture ? "fixture" : "local",
      staleSuccess: "blocked",
      officialFact: "false"
    },
    {
      id: "core-assist-fact-metadata-research",
      text: researchMetadataText,
      authority: researchMetadata?.authority ?? "research_evidence_only",
      freshness: researchMetadata?.freshness ?? "missing:not-loaded",
      provenance: researchMetadata?.provenance ?? "missing:not-loaded",
      environment: researchMetadata?.fixture ? "fixture" : "local",
      staleSuccess: "blocked",
      officialFact: "false"
    },
    {
      id: "core-assist-fact-metadata-decision-context",
      text: decisionContextText,
      authority: "decision_context_facts_only",
      freshness: currentDecisionContext && decisionContextBridge.state === "ready" ? "source_scoped_current" : "missing_or_blocked",
      provenance: "decision_context_envelope",
      environment: "local",
      staleSuccess: "blocked",
      officialFact: "false"
    },
    {
      id: "core-assist-fact-metadata-portfolio-pingan",
      text: "Portfolio/Pingan fact metadata: portfolio source=omitted unless future approved live authority exists; Pingan source=imported snapshot with source as-of imported-at fetched-at freshness and warning metadata; authority=omitted or historical-only, not live holdings.",
      authority: "omitted_or_historical_only",
      freshness: "historical_or_stale_visible",
      provenance: "omitted_or_pingan_imported_snapshot",
      environment: "local",
      staleSuccess: "blocked",
      officialFact: "false"
    },
    {
      id: "core-assist-fact-metadata-review-history-current",
      text: reviewHistoryMetadataText,
      authority: reviewHistoryMetadata?.authority ?? "decision_context_review_read_only",
      freshness: reviewHistoryMetadata?.freshness ?? "missing:not-loaded",
      provenance: reviewHistoryMetadata?.provenance ?? "missing:not-loaded",
      environment: reviewHistoryMetadata?.fixture ? "fixture" : "local",
      staleSuccess: "blocked",
      officialFact: "false"
    },
    {
      id: "core-assist-fact-metadata-review-local-record",
      text: "Review/local-record fact metadata: review history is append-only when loaded but does not inherit local drafts; local records source=browser localStorage or iOS UserDefaults with source signature; authority=unofficial local-only for records and never portfolio, broker, cash, fee, position, or transaction facts.",
      authority: "append_only_review_or_local_only_record",
      freshness: "source_signature_scoped",
      provenance: "review_history_or_local_storage",
      environment: "local",
      staleSuccess: "blocked",
      officialFact: "false"
    },
    {
      id: "core-assist-fact-metadata-quant",
      text: quantEvidenceMetadataText,
      authority: quantEvidenceMetadata?.authority ?? "quant_evidence",
      freshness: quantEvidenceMetadata?.freshness ?? "missing:not-loaded",
      provenance: quantEvidenceMetadata?.provenance ?? "quant_evidence",
      environment: quantEvidenceMetadata?.fixture ? "fixture" : "local",
      staleSuccess: "blocked",
      officialFact: "false"
    },
    {
      id: "core-assist-fact-metadata-staging-release",
      text: stagingReleaseMetadataText,
      authority: stagingReleaseMetadata.authority,
      freshness: stagingReleaseMetadata.freshness,
      provenance: stagingReleaseMetadata.provenance,
      environment: "staging_preparation_production_no_go",
      staleSuccess: "blocked",
      officialFact: "false"
    }
  ], "CORE-ASSIST facts metadata authority ledger is unavailable.");
  renderList(failureStates, [
    "Failure-state board: loading, empty, stale, unavailable, unauthorized, conflict, offline, malformed, fixture-unavailable, and source-mismatch are first-class display states.",
    "Unauthorized is not converted to an empty success; stale is not converted to fresh; malformed is not hidden behind client fallback; conflict keeps the reason visible.",
    "Offline exposes local-only boundaries; source-mismatch hides current-source local records; fixture-unavailable remains labelled as fixture absence, not fact absence.",
    "Fail-closed clearing applies to source facts, local drafts, local records, and older in-flight responses before the console shows any current-state success."
  ], "CORE-ASSIST Web capability failure-state board is unavailable.");
  renderList(releaseReadiness, [
    "Read-only release status: completed for reviewed head f78ef83fbfc0096444d9996ec06c2b51efda5755; runtime readOnly=true and the squash merge has identical content.",
    "Verified release evidence: six-route GET-only smoke, SQLSTATE 25006 database write denial, backup, isolated restore, rollback, private ingress, and correlation IDs passed without official-fact mutation.",
    "Production NO_GO boundary: the completed candidate read-only release is not full production readiness, official fact-source promotion, broker access, or write enablement.",
    "Remaining blockers: no approved continuously current portfolio authority, physical-device journey/screenshots are not passed, and the known TLS hostname mismatch is not claimed as validated."
  ], "CORE-ASSIST Web capability release blocker boundary is unavailable.");
  renderList(releaseBlockers, [
    "Release blocker/status matrix: read-only candidate release=COMPLETED; production=NO_GO; iOS physical device=OWNER_WAIVED_NONBLOCKING_FAILURE; broker write=NOT_USED; official portfolio mutation=NOT_USED.",
    "Portfolio authority blocker: blocked until an approved live authoritative portfolio source exists; current Web console may show omitted or historical context only.",
    "Pingan source blocker: Pingan remains historical-only or last-imported, never live holdings, broker truth, reconciliation authority, or live risk-impact input.",
    "Release evidence status: released head f78ef83fbfc0096444d9996ec06c2b51efda5755 has verified exact-head runtime, GET-only smoke, database write denial, backup, isolated restore, rollback, and live candidate ingress evidence.",
    "Automation blocker: CodexPro watcher, always-on Stage Runner watcher, .ai-bridge, MCP, Cloudflare, automatic Stage discovery, and automatic merge remain frozen or forbidden.",
    "Promotion boundary: any future full-production change or merge still requires its own governed review and exact owner authorization."
  ], "CORE-ASSIST Web capability release blocker status matrix is unavailable.");
  renderList(platformReliability, [
    "Platform reliability evidence: the released candidate reports the exact reviewed identity, readOnly=true, and database readiness ready.",
    "Live smoke evidence: health, quote, research profile, decision context, Pingan snapshot, and review-history GETs passed with correlation IDs; no successful write request was sent.",
    "DB read-only denial evidence: verified with SQLSTATE 25006 and no probe table; production database mutation remains disabled.",
    "Rollback and recovery evidence: content-addressed backup, isolated no-network restore, rollback rehearsal, private ingress, and retained prior revision are verified.",
    "Mainline health and observability: npm run mainline-health-check remains dry-run by default, validates committed safety evidence, writes no production facts, sends no HTTP or SSH probes, and does not validate a physical iPhone.",
    "Health report ledger boundary: default repository-local dry-run evidence can remain required_not_claimed, but it cannot override the separately content-addressed exact-head release evidence recorded in READONLY-RELEASE-1.",
    "Platform reliability ledger: npm run platform-reliability-ledger still distinguishes configured repository-local evidence from exact-head release evidence across read_only_api_mode, staging_identity, get_only_smoke_scope, db_readonly_denial, rollback_rehearsal, backup_recovery, private_ingress, runtime_handoff, mainline_health, observability, and release_blockers, and keeps unresolved full-production lanes in releaseBlockers.",
    "Release blocker classification: missing, stale, unauthorized, conflict, offline, malformed, server-error, source-mismatch, unavailable, fixture, local, staging-preparation, production-NO_GO, and unknown evidence states must stay distinct.",
    "No-write platform boundary: this matrix is a capability-console evidence view only; it cannot enable staging deployment, production release, broker access, real-account access, production config, auto-merge, Stage Runner, watcher, .ai-bridge, MCP, or Cloudflare."
  ], "CORE-ASSIST platform reliability evidence matrix is unavailable.");
  renderList(productionAssessment, [
    "Production assessment preparation: accepted at repository-local evidence level while still blocked/evaluability-only; npm run production-readiness-assessment-preparation records repository-local blockers as non-clearing evidence and cannot mark production GO or READY.",
    "Read-only release summary: released head f78ef83fbfc0096444d9996ec06c2b51efda5755 has verified exact-head runtime, GET-only smoke, SQLSTATE 25006 denial, backup, restore, rollback, private ingress, review, and squash content equality evidence.",
    "Remaining blocker map: authoritative live portfolio source, physical-device journey/screenshots, certificate hostname validation, official fact-source promotion, broker no-write boundary, and production NO_GO remain explicit.",
    "Promotion checklist: the candidate read-only release is complete; full production readiness remains blocked and requires a separate owner decision, current review, and exact merge authorization.",
    "Accepted research step: QUANT-1B sample-split baseline backtest foundation is research-only, bound to the accepted QUANT-1A fixture snapshot identity, records train/validation/final-test boundaries, and cannot use final-test results for tuning.",
    "Accepted research step: QUANT-1C isolated shadow portfolio foundation keeps simulated cash, fees, positions, trades, orders, and NAV outside official portfolio, broker, accounting, and review facts.",
    "Accepted research step: QUANT-1D read-only integration exposes quant output only as labelled research evidence with limitations, sample boundary, staleness, and no candidate ordering or action authority.",
    "Post-release status parity: Web and iOS distinguish the completed read-only candidate release from full production NO_GO and the blocked authoritative live portfolio source.",
    "No-write boundary: this status surface enables no production DB write, broker write, official portfolio mutation, cash, fee, position, order, trade, fill, deployment, production config, new rollback/backup execution, SSH, HTTP, external DB, Cloudflare, MCP, Stage Runner watcher, .ai-bridge, or auto-merge work."
  ], "CORE-ASSIST production assessment preparation is unavailable.");
  renderList(quantReadiness, [
    "Quant research boundary: research evidence only; no ranking, recommendation, score, buy/sell/hold, target price, sizing, allocation, order, trade, fill, cash, fee, position, official portfolio, official review, broker, or production authority.",
    "Quant snapshot foundation: QUANT-1A uses repository-local fixture data only, with explicit source identity, source classification, as-of, fetched-at, data hash, snapshot hash, and verifier command coverage.",
    "Quant verification boundary: npm run quant-freeze-snapshot-verify recomputes canonical dataHash and snapshotHash, checks manifest/snapshot consistency, and rejects tampered or source-mismatched output.",
    "Quant baseline foundation: npm run quant-sample-split-baseline records train validation locked-final-test split registry, data identity, config identity, code identity, experiment identity, metrics, turnover, exposure, fees, accounting audit status, and failure report evidence.",
    "Quant final-test boundary: final-test rows are locked report-only, finalTestUsedForParameterSelection=false, finalTestUsedForAcceptanceThresholdFitting=false, and fixture outputs are not performance claims.",
    "Quant shadow foundation: npm run quant-shadow-portfolio records an isolated research-only simulation identity, frozen snapshot identity, baseline experiment identity, simulated orders, trades, cash, fees, positions, NAV, isolation audit, and failure report evidence.",
    "Quant shadow boundary: simulated artifacts remain outside official portfolio, official review, broker, accounting, live holdings, account truth, production, release, cash, fee, position, transaction, order, trade, and fill authority.",
    "Quant fixture boundary: fixture snapshots and future owner-authorized real snapshots must remain visibly distinct before any user-visible research evidence is integrated.",
    "Backtest prerequisite boundary: accepted sample-split baseline work binds data identity, config identity, code identity, experiment identity, costs, turnover, exposure, accounting audit, and failure reports.",
    "Shadow simulation boundary: accepted simulation remains isolated, research-only, and outside official portfolio, broker, accounting, and official review facts.",
    "Read-only integration status: quant evidence may enter decision context only as labelled research evidence with limitations, sample boundary, and staleness."
  ], "CORE-ASSIST Web capability quant research boundary is unavailable.");
  renderList(environmentBoundary, [
    "Fixture lane: repository-local demo data is inspectable and labelled; it cannot become real account fact, broker truth, live holding, or release evidence.",
    "Local lane: Web localStorage, iOS UserDefaults, simulator-adjacent checks, unit tests, contract tests, and dry-run health checks are current evidence lanes.",
    "Read-only release lane: reviewed head f78ef83fbfc0096444d9996ec06c2b51efda5755 has verified exact-head runtime, GET-only smoke, SQLSTATE 25006 denial, backup, isolated restore, rollback, and private ingress evidence.",
    "Production lane: NO_GO in this task; no production config, production write, production release, or production credential path is enabled."
  ], "CORE-ASSIST Web capability environment boundary is unavailable.");
  renderEvidenceLedger(requiredOutputEvidence, [
    {
      id: "core-assist-web-console-evidence-source-authority",
      text: "Required output evidence: source authority, freshness, provenance, and environment lane are visible per row for candidate, quote, research, human-review, local-record, portfolio, Pingan, quant, staging, and production facts.",
      authority: "authenticated_envelope",
      freshness: "fetched_as_of_visible",
      provenance: "visible",
      environment: "local",
      staleSuccess: "blocked",
      officialFact: "false"
    },
    {
      id: "core-assist-web-console-evidence-environment-boundary",
      text: "Environment evidence: fixture, local, completed read-only candidate release, and full-production NO_GO are separated; fixture data cannot become real facts and the read-only release does not approve production promotion.",
      authority: "none",
      freshness: "not_applicable",
      provenance: "visible",
      environment: "fixture_local_staging_production",
      staleSuccess: "blocked",
      officialFact: "false"
    },
    {
      id: "core-assist-web-console-evidence-failure-states",
      text: "Failure-state evidence: loading, empty, stale, unavailable, unauthorized, conflict, offline, malformed, fixture-unavailable, and source-mismatch are all row-addressable and block stale success.",
      authority: "authenticated_envelope",
      freshness: "fetched_as_of_visible",
      provenance: "visible",
      environment: "local",
      staleSuccess: "blocked",
      officialFact: "false"
    },
    {
      id: "core-assist-web-console-evidence-portfolio-pingan-boundary",
      text: "Portfolio and Pingan evidence: portfolio remains omitted without approved live authority, and Pingan remains historical-only or last-imported with as-of/imported/fetched metadata, never live holdings.",
      authority: "historical_only",
      freshness: "historical_or_stale_visible",
      provenance: "visible",
      environment: "local",
      staleSuccess: "blocked",
      officialFact: "false"
    },
    {
      id: "core-assist-web-console-evidence-quant-boundary",
      text: "Quant evidence: quant remains research evidence only and cannot enter official portfolio, broker, accounting, cash, fee, position, order, trade, fill, or official review facts.",
      authority: "research_evidence_only",
      freshness: "fetched_as_of_visible",
      provenance: "visible",
      environment: "local",
      staleSuccess: "blocked",
      officialFact: "false"
    },
    {
      id: "core-assist-web-console-evidence-local-records",
      text: "Local-record evidence: local records remain browser-local or iOS UserDefaults unofficial source-scoped records; source mismatch, stale, malformed, unauthorized, offline, or unavailable states hide saved records.",
      authority: "browser_local",
      freshness: "source_scoped_current",
      provenance: "visible",
      environment: "local",
      staleSuccess: "blocked",
      officialFact: "false"
    },
    {
      id: "core-assist-web-console-evidence-candidate-workflow",
      text: "Candidate workflow evidence: selected candidate, decision intake, decision context, advisory scope, human-review workspace, follow-up, review history, and decision-note workflow are capability statuses, not recommendation statuses.",
      authority: "authenticated_envelope",
      freshness: "fetched_as_of_visible",
      provenance: "visible",
      environment: "local",
      staleSuccess: "blocked",
      officialFact: "false"
    },
    {
      id: "core-assist-web-console-evidence-advisory-scope",
      text: "Advisory-scope evidence: allowed local factual assistance, unresolved gaps, and human-review context are visible without buy/sell/hold, ranking, score, target price, sizing, allocation, order, or trade semantics.",
      authority: "authenticated_envelope",
      freshness: "fetched_as_of_visible",
      provenance: "visible",
      environment: "local",
      staleSuccess: "blocked",
      officialFact: "false"
    },
    {
      id: "core-assist-web-console-production-assessment-blocked",
      text: "Production assessment evidence: full-production assessment remains blocked/evaluability-only; production remains NO_GO, separate owner authorization is required, and no full-production execution or promotion approval is claimed.",
      authority: "release_blocker_status_only",
      freshness: "blocked:production-NO_GO",
      provenance: "project_state_and_local_validation",
      environment: "production_no_go",
      staleSuccess: "blocked",
      officialFact: "false"
    },
    {
      id: "core-assist-web-console-evidence-advisory-safety",
      text: "Safety evidence: production_status=NO_GO, real_trading=NOT_USED, broker_write=NOT_USED, official_portfolio_mutation=NOT_USED, ios_physical_device=OWNER_WAIVED_NONBLOCKING_FAILURE with authentication/journey/screenshots NOT_PROVEN, watcher and auto-merge scopes frozen.",
      authority: "none",
      freshness: "not_applicable",
      provenance: "visible",
      environment: "production_no_go",
      staleSuccess: "blocked",
      officialFact: "false"
    }
  ], "CORE-ASSIST Web capability required-output evidence ledger is unavailable.");
  renderList(safety, [
    "Safety boundary: production_status=NO_GO, real_trading=NOT_USED, broker_write=NOT_USED, official_portfolio_mutation=NOT_USED, ios_physical_device=OWNER_WAIVED_NONBLOCKING_FAILURE; install/launch passed but authentication, candidate journey, and screenshots are NOT_PROVEN.",
    "Frozen boundary: .ai-bridge, CodexPro watcher, always-on Stage Runner watcher, MCP, Cloudflare, ChatGPT GPT settings, automatic Stage discovery, and automatic merge remain untouched.",
    "Advisory-only boundary: the console exposes facts, source authority, local notes, blockers, and review context only; it does not grant broker/account execution or portfolio mutation authority.",
    "No recommendation, ranking, score, buy/sell/hold instruction, target price, timing, sizing, allocation, order, trade, fill, cash, fee, position mutation, broker write, production write, portfolio mutation, or auto-merge entry point is exposed.",
    "Merge boundary: the released head's squash merge is recorded; the current deferred-upload local branch has no PR, and any future merge still requires independent review plus exact owner authorization."
  ], "CORE-ASSIST Web capability safety boundary is unavailable.");
}

function quantRefinementMetadata(evidence: DecisionQuantEvidence | null): { state: string; id: string } {
  const refinement = evidence?.decisionEvidence;
  return {
    state: refinement?.status ?? "not_captured",
    id: refinement?.refinementId ?? "missing:not-captured"
  };
}

function quantHkConnectLabel(evidence: DecisionQuantEvidence | null): string {
  const universe = evidence?.identities?.hkConnectUniverse;
  return universe ? `${universe.effectiveDate}:${universe.snapshotId}:${universe.memberCount}` : "missing:not-bound";
}

function ensureCoreAssistWebCapabilityConsoleHardeningPanel(): void {
  if (document.getElementById("core-assist-web-capability-console-hardening")) return;
  const host = document.getElementById("core-assist-loop-closure-checkpoint")
    ?? document.getElementById("assist-full-system-0-15-development-console")
    ?? document.getElementById("assist-full-local-beta-console")
    ?? document.getElementById("assist-local-records")
    ?? document.getElementById("assist-decision-note-workflow")
    ?? document.getElementById("assist-review-follow-up-workflow")
    ?? document.getElementById("assist-human-review-workspace")
    ?? document.getElementById("assist-advisory-scope")
    ?? document.getElementById("candidate-decision-intake")
    ?? document.getElementById("candidate-memberships");
  if (!host?.parentElement) return;
  const section = document.createElement("section");
  section.id = "core-assist-web-capability-console-hardening";
  section.className = "core-assist-web-capability-console-hardening";
  section.dataset.testid = "core-assist-web-capability-console-hardening";
  section.setAttribute("aria-label", "CORE ASSIST Web capability console hardening");
  section.innerHTML = [
    "<div class=\"section-heading\">",
    "<h2>CORE-ASSIST Web capability console</h2>",
    "</div>",
    "<h3>Module status dashboard</h3>",
    "<ul id=\"core-assist-web-console-module-status-dashboard\" data-testid=\"core-assist-web-console-module-status-dashboard\"></ul>",
    "<h3>Source authority ledger</h3>",
    "<ul id=\"core-assist-web-console-source-authority-ledger\" data-testid=\"core-assist-web-console-source-authority-ledger\"></ul>",
    "<h3>Candidate workflow status</h3>",
    "<ul id=\"core-assist-web-console-candidate-workflow-status\" data-testid=\"core-assist-web-console-candidate-workflow-status\"></ul>",
    "<h3>Local records status</h3>",
    "<ul id=\"core-assist-web-console-local-records-status\" data-testid=\"core-assist-web-console-local-records-status\"></ul>",
    "<h3>Portfolio source status</h3>",
    "<ul id=\"core-assist-web-console-portfolio-source-status\" data-testid=\"core-assist-web-console-portfolio-source-status\"></ul>",
    "<h3>Portfolio historical authority boundary matrix</h3>",
    "<ul id=\"core-assist-portfolio-historical-authority-boundary-matrix\" data-testid=\"core-assist-portfolio-historical-authority-boundary-matrix\"></ul>",
    "<h3>Facts metadata authority ledger</h3>",
    "<ul id=\"core-assist-facts-metadata-authority-ledger\" data-testid=\"core-assist-facts-metadata-authority-ledger\"></ul>",
    "<h3>Failure-state board</h3>",
    "<ul id=\"core-assist-web-console-failure-state-board\" data-testid=\"core-assist-web-console-failure-state-board\"></ul>",
    "<h3>Release blocker and authorization boundary board</h3>",
    "<ul id=\"core-assist-web-console-release-readiness-board\" data-testid=\"core-assist-web-console-release-readiness-board\"></ul>",
    "<h3>Release blocker/status matrix</h3>",
    "<ul id=\"core-assist-web-console-release-blocker-status-matrix\" data-testid=\"core-assist-web-console-release-blocker-status-matrix\"></ul>",
    "<h3>Platform reliability evidence matrix</h3>",
    "<ul id=\"core-assist-platform-reliability-readiness-matrix\" data-testid=\"core-assist-platform-reliability-readiness-matrix\"></ul>",
    "<h3>Production assessment preparation</h3>",
    "<ul id=\"core-assist-production-assessment-preparation-board\" data-testid=\"core-assist-production-assessment-preparation-board\"></ul>",
    "<h3>Quant research boundary board</h3>",
    "<ul id=\"core-assist-web-console-quant-readiness-board\" data-testid=\"core-assist-web-console-quant-readiness-board\"></ul>",
    "<h3>Environment boundary</h3>",
    "<ul id=\"core-assist-web-console-environment-boundary-board\" data-testid=\"core-assist-web-console-environment-boundary-board\"></ul>",
    "<h3>Required-output evidence ledger</h3>",
    "<ul id=\"core-assist-web-console-required-output-evidence-ledger\" data-testid=\"core-assist-web-console-required-output-evidence-ledger\"></ul>",
    "<h3>Safety boundary</h3>",
    "<ul id=\"core-assist-web-console-safety-boundary\" data-testid=\"core-assist-web-console-safety-boundary\"></ul>"
  ].join("");
  host.insertAdjacentElement("afterend", section);
}

type CoreAssistWebCapabilityEvidenceRow = {
  id: string;
  text: string;
  authority: string;
  freshness: string;
  provenance: string;
  environment: string;
  staleSuccess: string;
  officialFact: string;
};

function renderEvidenceLedger(list: HTMLElement, rows: CoreAssistWebCapabilityEvidenceRow[], emptyText: string): void {
  list.innerHTML = "";
  const items = rows.length > 0 ? rows : [{
    id: `${list.id}-empty`,
    text: emptyText,
    authority: "none",
    freshness: "not_applicable",
    provenance: "missing",
    environment: "local",
    staleSuccess: "blocked",
    officialFact: "false"
  }];
  for (const row of items) {
    const item = document.createElement("li");
    item.id = row.id;
    item.dataset.testid = row.id;
    item.dataset.authority = row.authority;
    item.dataset.freshness = row.freshness;
    item.dataset.provenance = row.provenance;
    item.dataset.environment = row.environment;
    item.dataset.staleSuccess = row.staleSuccess;
    item.dataset.officialFact = row.officialFact;
    item.textContent = row.text;
    list.append(item);
  }
}
