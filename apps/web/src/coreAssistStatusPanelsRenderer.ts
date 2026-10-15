import type { CoreJourneyData } from "./coreJourneyState.js";
import type { CandidateMembershipRenderModel } from "./candidateMembershipState.js";
import type { CandidateDecisionIntakeRenderModel } from "./candidateDecisionIntakeState.js";
import type { AssistAdvisoryScopeRenderModel } from "./assistAdvisoryScopeState.js";
import type { AssistHumanReviewWorkspaceRenderModel } from "./assistHumanReviewWorkspaceState.js";
import type { AssistReviewFollowUpWorkflowRenderModel } from "./assistReviewFollowUpWorkflowState.js";
import type { AssistDecisionNoteWorkflowRenderModel } from "./assistDecisionNoteWorkflowState.js";
import { renderList } from "./domRender.js";
import { coreAssistUnifiedFailureStateMetadataPolicyForUiStates, coreAssistUnifiedFailureStateSummaryForUiStates } from "./coreAssistUnifiedFailureState.js";
import { selectedCandidateDecisionBridgeFromState } from "./selectedCandidateDecisionBridge.js";
import {
  selectedCandidateAdvisoryScopeBridgeFromState,
  selectedCandidateDecisionContextBridgeFromState,
  selectedCandidateDecisionNoteWorkflowBridgeFromState,
  selectedCandidateFollowUpWorkflowBridgeFromState,
  selectedCandidateHumanReviewWorkspaceBridgeFromState
} from "./selectedCandidateWorkflowBridges.js";

export interface CoreAssistStatusPanelsRenderContext {
  data: CoreJourneyData | null;
  busy: boolean;
  candidateMemberships: CandidateMembershipRenderModel;
  membershipBusy: boolean;
  decisionIntake: CandidateDecisionIntakeRenderModel;
  assistAdvisoryScope: AssistAdvisoryScopeRenderModel;
  assistAdvisoryScopeBusy: boolean;
  assistHumanReviewWorkspace: AssistHumanReviewWorkspaceRenderModel;
  assistHumanReviewWorkspaceBusy: boolean;
  assistReviewFollowUpWorkflow: AssistReviewFollowUpWorkflowRenderModel;
  assistReviewFollowUpWorkflowBusy: boolean;
  assistDecisionNoteWorkflow: AssistDecisionNoteWorkflowRenderModel;
  assistDecisionNoteWorkflowBusy: boolean;
}

export function renderCoreAssistStatusPanels(context: CoreAssistStatusPanelsRenderContext): void {
  renderAssistPreDeviceBetaRcGatePanel();
  renderAssistLocalBetaProductSplitConsolePanel();
  renderAssistFullLocalBetaConsolePanel();
  renderAssistFullSystemDevelopmentConsolePanel();
  renderCoreAssistLoopClosureCheckpointPanel(context);
}

function attachOperatorDiagnosticPanel(fallbackHost: HTMLElement, section: HTMLElement): void {
  const diagnostics = document.getElementById("operator-diagnostics-content");
  if (diagnostics) {
    diagnostics.append(section);
    return;
  }
  fallbackHost.insertAdjacentElement("afterend", section);
}

function renderAssistPreDeviceBetaRcGatePanel(): void {
  if (typeof document === "undefined") return;
  ensureAssistPreDeviceBetaRcGatePanel();
  const section = document.getElementById("assist-pre-device-local-beta-rc-gate");
  const readiness = document.getElementById("assist-pre-device-local-beta-rc-readiness");
  const limitations = document.getElementById("assist-pre-device-local-beta-rc-limitations");
  const safety = document.getElementById("assist-pre-device-local-beta-rc-safety");
  const nextStep = document.getElementById("assist-pre-device-local-beta-rc-next-step");
  if (!section || !readiness || !limitations || !safety || !nextStep) return;
  section.setAttribute("data-state", "historical_pre_device_local_beta_rc");
  section.setAttribute("data-production", "NO_GO");
  section.setAttribute("data-ios-device-test", "OWNER_WAIVED_NONBLOCKING_FAILURE");
  section.setAttribute("data-historical-checkpoint-ios-device-test", "NOT_USED");
  section.setAttribute("data-readonly-release", "COMPLETED");
  renderList(readiness, [
    "Historical checkpoint ASSIST-1-PRE-DEVICE-LOCAL-BETA-RC: repository-local API/Web/iOS/contract loop was prepared for local review and physical-device testing was NOT_USED at that checkpoint.",
    "Current status: the reviewed read-only candidate release is complete; physical-device install/launch passed, but the owner-waived XCTest DTX bootstrap failure did not prove authentication, the candidate journey, or screenshots.",
    "Developer verification covers candidate membership, selected candidate, research profile, decision context, decision intake, advisory scope, human-review workspace, follow-up workflow, decision-note workflow, local drafts, fail-closed clearing, Pingan historical-only, portfolio omitted, and blocked external actions.",
    "Web stable selectors and iOS accessibility identifiers are present for the local beta RC evidence path."
  ], "Pre-device beta RC readiness is unavailable.");
  renderList(limitations, [
    "Historical scope: this checkpoint described a local beta release candidate, not production, staging, broker-connected, real-account, or authoritative portfolio software.",
    "Current device evidence: install/launch occurred; authentication, candidate-to-review journey, and screenshots remain NOT_PROVEN after the owner-waived DTX failure.",
    "Production remains NO_GO until the separate release-environment blocker chain is resolved."
  ], "Pre-device beta RC limitations are unavailable.");
  renderList(safety, [
    "Not investment advice; no recommendation, ranking, scoring, buy/sell/hold instruction, target price, stop loss, take profit, expected return, sizing, allocation, order, trade, fill, cash, fee, position, broker execution, or portfolio mutation.",
    "Local drafts are browser-memory-only display intent, separate from saved local records and official review history; they are not official decision records, not persisted as official decisions, and not sent.",
    "Unavailable, malformed, unauthorized, stale, offline, superseded, or candidate-mismatch states fail closed and must not restore stale facts or drafts."
  ], "Pre-device beta RC safety proof is unavailable.");
  renderList(nextStep, [
    "Historical next gate was repository-local daily-use acceptance. Current boundary: the read-only candidate release is completed, full production remains NO_GO, and CORE-1B-LIVE-CURRENT-SOURCE remains blocked."
  ], "Pre-device beta RC next step is unavailable.");
}

function ensureAssistPreDeviceBetaRcGatePanel(): void {
  if (document.getElementById("assist-pre-device-local-beta-rc-gate")) return;
  const host = document.getElementById("assist-decision-note-workflow")
    ?? document.getElementById("assist-review-follow-up-workflow")
    ?? document.getElementById("assist-human-review-workspace")
    ?? document.getElementById("assist-advisory-scope")
    ?? document.getElementById("candidate-decision-intake")
    ?? document.getElementById("candidate-memberships");
  if (!host?.parentElement) return;
  const section = document.createElement("section");
  section.id = "assist-pre-device-local-beta-rc-gate";
  section.className = "assist-pre-device-local-beta-rc-gate";
  section.dataset.testid = "assist-pre-device-local-beta-rc-gate";
  section.setAttribute("aria-label", "ASSIST-1 pre-device local beta RC gate");
  section.innerHTML = [
    "<div class=\"section-heading\">",
    "<h2>ASSIST-1 pre-device local beta RC</h2>",
    "</div>",
    "<h3>Readiness</h3>",
    "<ul id=\"assist-pre-device-local-beta-rc-readiness\" data-testid=\"assist-pre-device-local-beta-rc-readiness\"></ul>",
    "<h3>Limitations</h3>",
    "<ul id=\"assist-pre-device-local-beta-rc-limitations\" data-testid=\"assist-pre-device-local-beta-rc-limitations\"></ul>",
    "<h3>Safety boundary</h3>",
    "<ul id=\"assist-pre-device-local-beta-rc-safety\" data-testid=\"assist-pre-device-local-beta-rc-safety\"></ul>",
    "<h3>Next step</h3>",
    "<ul id=\"assist-pre-device-local-beta-rc-next-step\" data-testid=\"assist-pre-device-local-beta-rc-next-step\"></ul>"
  ].join("");
  attachOperatorDiagnosticPanel(host, section);
}

function renderAssistLocalBetaProductSplitConsolePanel(): void {
  if (typeof document === "undefined") return;
  ensureAssistLocalBetaProductSplitConsolePanel();
  const section = document.getElementById("assist-local-beta-product-split-console");
  const webRole = document.getElementById("assist-web-capability-console-role");
  const candidateStates = document.getElementById("assist-web-capability-console-candidate-states");
  const chain = document.getElementById("assist-web-capability-console-chain");
  const fixtureStatus = document.getElementById("assist-web-capability-console-fixture-status");
  const iosRole = document.getElementById("assist-ios-daily-use-frontend-role");
  const safety = document.getElementById("assist-local-beta-product-split-safety");
  const nextStep = document.getElementById("assist-local-beta-product-split-next-step");
  if (!section || !webRole || !candidateStates || !chain || !fixtureStatus || !iosRole || !safety || !nextStep) return;

  section.setAttribute("data-state", "historical_pre_device_product_split_ready");
  section.setAttribute("data-web-role", "capability_console");
  section.setAttribute("data-ios-role", "daily_use_frontend");
  section.setAttribute("data-production", "NO_GO");
  section.setAttribute("data-ios-physical-device", "OWNER_WAIVED_NONBLOCKING_FAILURE");
  section.setAttribute("data-historical-checkpoint-ios-physical-device", "NOT_USED");
  section.setAttribute("data-readonly-release", "COMPLETED");

  renderList(webRole, [
    "Web is the ASSIST-1 capability console for local integration, state inspection, fixture verification, and administration.",
    "Web keeps candidate membership lifecycle controls, selected-candidate facts, module readiness, stale/missing/unavailable states, and blocked external actions visible with stable selectors.",
    "Web is not the daily-use recommendation surface and does not rank, score, recommend, buy, sell, hold, allocate, trade, or mutate portfolio facts."
  ], "Web capability-console role is unavailable.");
  renderList(candidateStates, [
    "Candidate membership states: tracked, paused, archived, restored, stale-version, missing research, missing quote, unauthorized, unavailable, malformed.",
    "Selected candidate state remains factual and user-managed; candidate lists are not recommendations, rankings, scores, or portfolio-derived priorities.",
    "Blocked external actions remain visible for broker calls, production release, live holdings sync, portfolio mutation, and persisted official-note writes."
  ], "Candidate state console is unavailable.");
  renderList(chain, [
    "candidate membership -> selected candidate -> research profile -> decision context -> decision intake -> advisory scope -> human-review workspace -> follow-up workflow -> decision-note workflow -> beta RC gate",
    "Each module stays read-only or local-only as already defined by its contract/API/client surface; failed, superseded, stale, unauthorized, malformed, unavailable, or offline reads clear stale facts and drafts.",
    "API, Web, iOS, and contract semantics remain shared even though Web presents a capability console and iOS presents a daily-use frontend."
  ], "ASSIST-1 capability chain is unavailable.");
  renderList(fixtureStatus, [
    "Repository-local demo/fixture path is allowed for local observation only.",
    "Demo data must stay marked as fixture, historical-only, unavailable, or portfolio omitted as applicable.",
    "Fixture and Pingan historical-only context are never displayed as live holdings, real account facts, broker truth, or investment advice."
  ], "Fixture status is unavailable.");
  renderList(iosRole, [
    "iOS is the daily-use mobile frontend for opening the selected candidate, reading the research/context/workspace path, drafting local-only notes, and seeing the next local review action.",
    "iOS keeps safety copy concise and product-facing; detailed integration and status inspection belongs in Web.",
    "Historical checkpoint: physical-device smoke was not used during product-split acceptance. Current evidence records install/launch passed and an owner-waived DTX failure with authentication, journey, and screenshots NOT_PROVEN."
  ], "iOS daily-use role is unavailable.");
  renderList(safety, [
    "Production remains NO_GO. The completed read-only candidate release does not authorize new staging/production execution, VPS/SSH, broker, real account, external DB, deployment, backup, secrets, signing, or physical-device actions.",
    "No recommendation, ranking, scoring, buy/sell/hold instruction, timing, target price, stop loss, take profit, expected return, sizing, allocation, order, trade, fill, cash, fee, position, broker, or portfolio mutation behavior.",
    "Local drafts remain browser-memory-only or SwiftUI-memory-only display intent, separate from saved local records and official review history; they are not official records, not persisted, and not sent."
  ], "Product split safety proof is unavailable.");
  renderList(nextStep, [
    "Historical next task was ASSIST-1-LOCAL-BETA-DAILY-USE-ACCEPTANCE-1. Full local validation is complete; the deferred GitHub submission has not started, and CORE-1B-LIVE-CURRENT-SOURCE remains blocked."
  ], "Product split next task is unavailable.");
}

function ensureAssistLocalBetaProductSplitConsolePanel(): void {
  if (document.getElementById("assist-local-beta-product-split-console")) return;
  const host = document.getElementById("assist-pre-device-local-beta-rc-gate")
    ?? document.getElementById("assist-decision-note-workflow")
    ?? document.getElementById("assist-review-follow-up-workflow")
    ?? document.getElementById("assist-human-review-workspace")
    ?? document.getElementById("assist-advisory-scope")
    ?? document.getElementById("candidate-decision-intake")
    ?? document.getElementById("candidate-memberships");
  if (!host?.parentElement) return;
  const section = document.createElement("section");
  section.id = "assist-local-beta-product-split-console";
  section.className = "assist-local-beta-product-split-console";
  section.dataset.testid = "assist-local-beta-product-split-console";
  section.setAttribute("aria-label", "ASSIST-1 local beta product split console");
  section.innerHTML = [
    "<div class=\"section-heading\">",
    "<h2>ASSIST-1 local beta product split</h2>",
    "</div>",
    "<h3>Web capability console</h3>",
    "<ul id=\"assist-web-capability-console-role\" data-testid=\"assist-web-capability-console-role\"></ul>",
    "<h3>Candidate and blocked states</h3>",
    "<ul id=\"assist-web-capability-console-candidate-states\" data-testid=\"assist-web-capability-console-candidate-states\"></ul>",
    "<h3>Capability chain</h3>",
    "<ul id=\"assist-web-capability-console-chain\" data-testid=\"assist-web-capability-console-chain\"></ul>",
    "<h3>Demo and fixture status</h3>",
    "<ul id=\"assist-web-capability-console-fixture-status\" data-testid=\"assist-web-capability-console-fixture-status\"></ul>",
    "<h3>iOS daily-use frontend</h3>",
    "<ul id=\"assist-ios-daily-use-frontend-role\" data-testid=\"assist-ios-daily-use-frontend-role\"></ul>",
    "<h3>Safety boundary</h3>",
    "<ul id=\"assist-local-beta-product-split-safety\" data-testid=\"assist-local-beta-product-split-safety\"></ul>",
    "<h3>Next local task</h3>",
    "<ul id=\"assist-local-beta-product-split-next-step\" data-testid=\"assist-local-beta-product-split-next-step\"></ul>"
  ].join("");
  attachOperatorDiagnosticPanel(host, section);
}

function renderAssistFullLocalBetaConsolePanel(): void {
  if (typeof document === "undefined") return;
  ensureAssistFullLocalBetaConsolePanel();
  const section = document.getElementById("assist-full-local-beta-console");
  const operatorSummary = document.getElementById("assist-full-local-beta-operator-summary");
  const operatorHealth = document.getElementById("assist-full-local-beta-operator-health");
  const moduleMap = document.getElementById("assist-full-local-beta-module-map");
  const failClosedStatus = document.getElementById("assist-full-local-beta-fail-closed-status");
  const localDraftStatus = document.getElementById("assist-full-local-beta-local-draft-status");
  const blockedActions = document.getElementById("assist-full-local-beta-blocked-actions");
  const sourceBoundaries = document.getElementById("assist-full-local-beta-source-boundaries");
  const validationStatus = document.getElementById("assist-full-local-beta-validation-status");
  const fullGoalMatrix = document.getElementById("assist-full-local-beta-1-12-acceptance-matrix");
  const webStatus = document.getElementById("assist-full-local-beta-web-status");
  const iosStatus = document.getElementById("assist-full-local-beta-ios-status");
  const sharedSemantics = document.getElementById("assist-full-local-beta-shared-semantics");
  const demoFixtures = document.getElementById("assist-full-local-beta-demo-fixtures");
  const researchDecision = document.getElementById("assist-full-local-beta-research-decision-context");
  const noteFollowUp = document.getElementById("assist-full-local-beta-decision-note-follow-up");
  const portfolioBoundary = document.getElementById("assist-full-local-beta-portfolio-boundary");
  const reliability = document.getElementById("assist-full-local-beta-reliability");
  const nextTask = document.getElementById("assist-full-local-beta-next-task");
  if (!section || !operatorSummary || !operatorHealth || !moduleMap || !failClosedStatus || !localDraftStatus || !blockedActions || !sourceBoundaries || !validationStatus || !fullGoalMatrix || !webStatus || !iosStatus || !sharedSemantics || !demoFixtures || !researchDecision || !noteFollowUp || !portfolioBoundary || !reliability || !nextTask) return;

  section.setAttribute("data-state", "full_local_beta_ready");
  section.setAttribute("data-operator-console", "ready");
  section.setAttribute("data-web-role", "capability_console");
  section.setAttribute("data-ios-role", "daily_use_frontend");
  section.setAttribute("data-fixture-mode", "repository_local_visible");
  section.setAttribute("data-production", "NO_GO");
  section.setAttribute("data-ios-physical-device", "OWNER_WAIVED_NONBLOCKING_FAILURE");
  section.setAttribute("data-staging", "READONLY_CANDIDATE_RELEASED");
  section.setAttribute("data-broker", "NOT_USED");
  section.setAttribute("data-portfolio-authority", "omitted_or_historical_only");
  section.setAttribute("data-full-goal-mode", "historical_1-12_single_development_target");
  section.setAttribute("data-full-goal-steps", "12");
  section.setAttribute("data-next-local-task", "none");
  section.setAttribute("data-next-governance-task", "FULL-PROJECT-DEFERRED-GITHUB-SUBMISSION-1");
  section.setAttribute("data-next-boundary", "CORE-1B-LIVE-CURRENT-SOURCE");
  section.setAttribute("data-local-validation", "COMPLETED");
  section.setAttribute("data-github-submission", "READY_NOT_STARTED");

  renderList(operatorSummary, [
    "LOCAL CONSOLE ACTIVE: Web is the ASSIST-1 local capability console for integration, state, fixture, admin, and verification inspection.",
    "Operator scan order: capability health -> module map -> fail-closed/draft state -> blocked actions -> source boundaries -> validation -> next local task.",
    "iOS remains the daily-use frontend; Web is not a mobile daily-use replacement and not a recommendation, ranking, trading, broker, or portfolio-action surface."
  ], "Operator summary is unavailable.");
  renderList(operatorHealth, [
    "Capability health: candidate membership, selected candidate, research profile, decision context, decision intake, advisory scope, human-review workspace, follow-up workflow, and decision-note workflow are visible in one console.",
    "Fixture/demo health: normal, stale, missing research, missing quote, unauthorized, unavailable, malformed, blocked external action, Pingan historical-only, portfolio omitted, local-only draft, follow-up, and unresolved-gap states remain inspectable.",
    "Release health: reviewed read-only candidate release COMPLETED; production NO_GO; broker NOT_USED; physical-device install/launch passed with owner-waived DTX failure and authentication/journey/screenshots NOT_PROVEN."
  ], "Operator health is unavailable.");
  renderList(moduleMap, [
    "Candidate membership: tracked, paused, archived, restored, duplicate, stale-version, missing research, missing quote, unauthorized, unavailable, malformed.",
    "Decision path: selected candidate -> research profile -> decision context -> decision intake -> advisory scope -> human-review workspace -> follow-up workflow -> decision-note workflow.",
    "Client roles: Web operator console validates capability/state; iOS daily-use frontend presents the selected-candidate mobile workspace."
  ], "Module map is unavailable.");
  renderList(failClosedStatus, [
    "Fail-closed status: unauthorized, not found, unavailable, malformed, offline, superseded, stale, blocked, and candidate-mismatch reads expose no stale facts.",
    "Stale clearing status: failed or superseded workflow loads clear old workflow facts before rendering new state.",
    "Draft and local-record clearing status: fail-closed or superseded workflow loads clear browser-memory-only drafts and hide source-scoped saved local records."
  ], "Fail-closed status is unavailable.");
  renderList(localDraftStatus, [
    "Local draft status: browser-memory-only or SwiftUI-memory-only display intent, separate from source-scoped saved local records.",
    "Drafts are separate from official review history, not official review records, not persisted, and not sent.",
    "Local record status: browser localStorage or iOS UserDefaults can save source-scoped unofficial research/decision thoughts only.",
    "Decision-note, follow-up, and local records can help local review, but they do not create recommendations, official records, portfolio facts, orders, trades, or broker actions."
  ], "Local draft status is unavailable.");
  renderList(blockedActions, [
    "Blocked external actions: no broker call, no order, no trade, no fill, no cash mutation, no fee mutation, no position mutation, no portfolio mutation.",
    "Blocked advisory actions: no recommendation, ranking, scoring, buy/sell/hold instruction, target price, stop loss, take profit, expected return, timing, sizing, or allocation.",
    "Blocked environment actions: this console enables no new staging/production, VPS, SSH, external DB, backup, deployment, real-account, signing/provisioning, physical-device, or live-runtime operation."
  ], "Blocked external actions are unavailable.");
  renderList(sourceBoundaries, [
    "Pingan source boundary: historical-only, not live holdings, not broker truth, not automatically current, not authoritative for live risk impact.",
    "Portfolio boundary: omitted or non-authoritative; stale historical positions cannot drive actionable risk-impact conclusions.",
    "Fixture boundary: repository-local sample/demo facts are labelled and never promoted to real account facts or investment advice."
  ], "Source boundaries are unavailable.");
  renderList(validationStatus, [
    "Validation status: project-state verify, build, typecheck, lint, unit tests, contract tests, mainline health dry-run, Gate B DTO smoke, and Gate B iOS UI smoke completed for the deferred-upload local branch.",
    "Artifact status: generated artifacts, screenshots, DerivedData, dist, node_modules, and .ai-bridge remain out of the committed package.",
    "Review status: the complete base-to-head branch review has no unresolved P1 or P2; no push or PR has started."
  ], "Validation status is unavailable.");
  renderList(fullGoalMatrix, [
    "1. Governance and boundary baseline: one deferred-upload local branch, production NO_GO, physical-device OWNER_WAIVED_NONBLOCKING_FAILURE with journey NOT_PROVEN, no Stage Runner, and no GitHub Issue mutation.",
    "2. Candidate membership lifecycle: tracked, paused, archived, restored, duplicate, stale-version, unauthorized, unavailable, malformed, missing research, and missing quote states are visible.",
    "3. Selected candidate workspace: selected candidate, current focus, next local action, and no-selected-candidate fallback are visible without ranking or priority semantics.",
    "4. Research profile and evidence: evidence count, source freshness, missing/stale/unavailable states, and refusal to infer missing facts are visible.",
    "5. Decision context and intake: quote status, research status, portfolio omitted/non-authoritative status, and decision-preparation state remain factual and read-only.",
    "6. Advisory scope: allowed local factual assistance and blocked recommendation/trading semantics remain explicit.",
    "7. Human-review workspace: local human review facts, unresolved gaps, safety boundaries, and fail-closed states are inspectable.",
    "8. Follow-up workflow: manual note draft intent, later-review marker, unresolved evidence gaps, local next views, and blocked external actions remain local-only.",
    "9. Decision-note and local-record workflow: local rationale, source-scoped saved thoughts, and note draft fields remain local-only and unofficial; drafts are not persisted, records are client-local only, and nothing is sent.",
    "10. Web capability console: Web exposes integration/state/fixture/admin verification selectors for the complete local beta path.",
    "11. iOS daily-use frontend: iOS exposes concise selected-candidate daily review fields and accessibility identifiers without physical-device requirements.",
    "12. Reliability, audit, and review package: local validation and final review are complete; one deferred GitHub submission is ready but has not started, and no PR exists yet."
  ], "Full 1-12 local beta acceptance matrix is unavailable.");

  renderList(webStatus, [
    "LOCAL-BETA CONSOLE VISIBLE: Web capability console links candidate membership, selected candidate, research profile, decision context, decision intake, advisory scope, human-review workspace, follow-up workflow, decision-note workflow, local records, beta RC gate, and full local-beta acceptance.",
    "Visible console states include tracked, paused, archived, restored, duplicate, stale-version, missing research, missing quote, unauthorized, unavailable, malformed, stale, blocked external actions, fixture/demo, Pingan historical-only, portfolio omitted, and production NO_GO.",
    "Web remains an inspection and administration console; it does not present candidate lists as recommendations, rankings, scores, priorities, or portfolio-derived actions."
  ], "Full local beta Web status is unavailable.");
  renderList(iosStatus, [
    "LOCAL-BETA IOS SURFACE VISIBLE: iOS daily-use frontend exposes selected candidate, current focus, concise research/context/workspace summaries, unresolved evidence gaps, local-only drafts, source-scoped local records, follow-up workflow, next local action, and safety boundaries.",
    "iOS keeps product-facing copy concise and uses accessibility identifiers for the daily path instead of showing backend audit matrices.",
    "Current iOS evidence includes local Simulator checks plus recorded physical-device install/launch; the owner-waived DTX failure leaves authentication, candidate journey, and screenshots NOT_PROVEN, with no new signing, provisioning, Apple ID, or trust change enabled here."
  ], "Full local beta iOS status is unavailable.");
  renderList(sharedSemantics, [
    "Shared semantics remain factual: DTO/envelope values drive Web and iOS, while each client presents a different product form.",
    "Fail-closed states clear stale facts and local drafts for unauthorized, not found, unavailable, malformed, offline, superseded, blocked, stale, or candidate-mismatch reads.",
    "No hidden production, broker, real-account, official portfolio, official decision-record, server-persisted local-note, or local-draft authority is introduced."
  ], "Full local beta shared semantics are unavailable.");
  renderList(demoFixtures, [
    "Repository-local fixture path covers a normal tracked candidate, stale candidate, missing research, missing quote, unavailable/malformed-style fail-closed states, blocked external actions, Pingan historical-only, portfolio omitted, follow-up workflow, local-only decision-note draft, and unresolved evidence gaps.",
    "Fixture/demo data is labelled as repository-local, sample, historical-only, unavailable, or omitted; it is never broker truth, live holdings, real account facts, or investment advice.",
    "Local reviewers can use the Web console for full fixture visibility and iOS for the simplified daily-use path."
  ], "Full local beta fixture status is unavailable.");
  renderList(researchDecision, [
    "Research evidence remains factual with evidence counts, quote freshness, source timestamps, as-of/imported/fetched warnings, and explicit missing/stale states.",
    "Decision context and advisory scope refuse to infer missing evidence, stale quotes, unavailable Pingan context, omitted portfolio facts, or unresolved gaps.",
    "The local path explains why a candidate is being reviewed without buy/sell/hold, ranking, scoring, target-price, expected-return, sizing, allocation, or timing output."
  ], "Full local beta research and decision context status is unavailable.");
  renderList(noteFollowUp, [
    "Decision-note, follow-up, and local-record workflows are usable as local-only support: local rationale, saved source-scoped thoughts, unresolved evidence gaps, later-review marker, and blocked external actions are visible.",
    "Drafts remain browser-memory-only or SwiftUI-memory-only and separate from saved local records; saved local records remain browser localStorage or iOS UserDefaults only. They are not official investment records, not official review history, not server persisted, and not sent.",
    "Fail-closed or superseded workflow loads clear stale drafts, hide stale saved local records, and do not restore partial facts."
  ], "Full local beta decision-note and follow-up status is unavailable.");
  renderList(portfolioBoundary, [
    "Pingan imported snapshot is historical-only, not live, not broker truth, not automatically current, not authoritative for live risk impact, and not an execution/accounting source.",
    "Portfolio context may be omitted; stale historical positions cannot drive actionable risk-impact conclusions.",
    "Source as-of, imported, fetched, conflict, missing, stale, unavailable, and omitted states fail closed instead of becoming current holdings."
  ], "Full local beta portfolio boundary status is unavailable.");
  renderList(reliability, [
    "Local reliability package is reviewable through source tests, contract tests, project-state verification, lint/risk scan, mainline health dry-run, Gate B DTO smoke, Gate B iOS UI smoke, and targeted iOS Simulator tests.",
    "Generated artifacts, screenshots, DerivedData, dist, node_modules, and .ai-bridge are not part of the committed product package.",
    "Production remains NO_GO until a future owner-authorized release-blocker review changes that state."
  ], "Full local beta reliability status is unavailable.");
  renderList(nextTask, [
    "Completed product task after failure-state unification acceptance: CORE-ASSIST-LOCAL-RECORDS-DRAFTS-HARDENING-1.",
    "Completed product task after local-record hardening: CORE-ASSIST-IOS-DAILY-USE-FRONTEND-HARDENING-1.",
    "Repository-local product work and the reviewed read-only candidate release are complete; CORE-1B-LIVE-CURRENT-SOURCE remains externally blocked."
  ], "Full local beta next task is unavailable.");
}

function ensureAssistFullLocalBetaConsolePanel(): void {
  if (document.getElementById("assist-full-local-beta-console")) return;
  const host = document.getElementById("assist-local-beta-product-split-console")
    ?? document.getElementById("assist-pre-device-local-beta-rc-gate")
    ?? document.getElementById("assist-decision-note-workflow")
    ?? document.getElementById("assist-review-follow-up-workflow")
    ?? document.getElementById("assist-human-review-workspace")
    ?? document.getElementById("assist-advisory-scope")
    ?? document.getElementById("candidate-decision-intake")
    ?? document.getElementById("candidate-memberships");
  if (!host?.parentElement) return;
  const section = document.createElement("section");
  section.id = "assist-full-local-beta-console";
  section.className = "assist-full-local-beta-console";
  section.dataset.testid = "assist-full-local-beta-console";
  section.setAttribute("aria-label", "ASSIST-1 full local beta console");
  section.innerHTML = [
    "<div class=\"section-heading\">",
    "<h2>ASSIST-1 full local beta</h2>",
    "</div>",
    "<h3>Operator snapshot</h3>",
    "<ul id=\"assist-full-local-beta-operator-summary\" data-testid=\"assist-full-local-beta-operator-summary\"></ul>",
    "<h3>Capability health</h3>",
    "<ul id=\"assist-full-local-beta-operator-health\" data-testid=\"assist-full-local-beta-operator-health\"></ul>",
    "<h3>Module map</h3>",
    "<ul id=\"assist-full-local-beta-module-map\" data-testid=\"assist-full-local-beta-module-map\"></ul>",
    "<h3>Fail-closed and stale clearing</h3>",
    "<ul id=\"assist-full-local-beta-fail-closed-status\" data-testid=\"assist-full-local-beta-fail-closed-status\"></ul>",
    "<h3>Local draft status</h3>",
    "<ul id=\"assist-full-local-beta-local-draft-status\" data-testid=\"assist-full-local-beta-local-draft-status\"></ul>",
    "<h3>Blocked actions</h3>",
    "<ul id=\"assist-full-local-beta-blocked-actions\" data-testid=\"assist-full-local-beta-blocked-actions\"></ul>",
    "<h3>Source boundaries</h3>",
    "<ul id=\"assist-full-local-beta-source-boundaries\" data-testid=\"assist-full-local-beta-source-boundaries\"></ul>",
    "<h3>Validation status</h3>",
    "<ul id=\"assist-full-local-beta-validation-status\" data-testid=\"assist-full-local-beta-validation-status\"></ul>",
    "<h3>1-12 full goal acceptance matrix</h3>",
    "<ul id=\"assist-full-local-beta-1-12-acceptance-matrix\" data-testid=\"assist-full-local-beta-1-12-acceptance-matrix\"></ul>",
    "<h3>Web capability console</h3>",
    "<ul id=\"assist-full-local-beta-web-status\" data-testid=\"assist-full-local-beta-web-status\"></ul>",
    "<h3>iOS daily-use frontend</h3>",
    "<ul id=\"assist-full-local-beta-ios-status\" data-testid=\"assist-full-local-beta-ios-status\"></ul>",
    "<h3>Shared API and contract semantics</h3>",
    "<ul id=\"assist-full-local-beta-shared-semantics\" data-testid=\"assist-full-local-beta-shared-semantics\"></ul>",
    "<h3>Local demo and fixture path</h3>",
    "<ul id=\"assist-full-local-beta-demo-fixtures\" data-testid=\"assist-full-local-beta-demo-fixtures\"></ul>",
    "<h3>Research evidence and decision context</h3>",
    "<ul id=\"assist-full-local-beta-research-decision-context\" data-testid=\"assist-full-local-beta-research-decision-context\"></ul>",
    "<h3>Decision note and follow-up loop</h3>",
    "<ul id=\"assist-full-local-beta-decision-note-follow-up\" data-testid=\"assist-full-local-beta-decision-note-follow-up\"></ul>",
    "<h3>Portfolio and Pingan boundary</h3>",
    "<ul id=\"assist-full-local-beta-portfolio-boundary\" data-testid=\"assist-full-local-beta-portfolio-boundary\"></ul>",
    "<h3>Reliability and audit package</h3>",
    "<ul id=\"assist-full-local-beta-reliability\" data-testid=\"assist-full-local-beta-reliability\"></ul>",
    "<h3>Next task</h3>",
    "<ul id=\"assist-full-local-beta-next-task\" data-testid=\"assist-full-local-beta-next-task\"></ul>"
  ].join("");
  attachOperatorDiagnosticPanel(host, section);
}

function renderAssistFullSystemDevelopmentConsolePanel(): void {
  if (typeof document === "undefined") return;
  ensureAssistFullSystemDevelopmentConsolePanel();
  const section = document.getElementById("assist-full-system-0-15-development-console");
  const topology = document.getElementById("assist-full-system-cn-topology");
  const matrix = document.getElementById("assist-full-system-0-15-development-matrix");
  const readinessMatrix = document.getElementById("assist-full-system-readiness-matrix");
  const remainingGaps = document.getElementById("assist-full-system-remaining-gaps");
  const localBeta = document.getElementById("assist-full-system-local-beta-status");
  const releaseBlockers = document.getElementById("assist-release-blocker-dashboard");
  const stagingPrep = document.getElementById("assist-staging-preparation-status");
  const devicePrep = document.getElementById("assist-ios-device-preparation-status");
  const productionPrep = document.getElementById("assist-production-preparation-status");
  const brokerPrep = document.getElementById("assist-broker-readonly-preparation-status");
  const quantBoundary = document.getElementById("assist-quant-research-boundary-status");
  const knowledgeLoop = document.getElementById("assist-knowledge-loop-status");
  const nextTask = document.getElementById("assist-full-system-next-task");
  if (!section || !topology || !matrix || !readinessMatrix || !remainingGaps || !localBeta || !releaseBlockers || !stagingPrep || !devicePrep || !productionPrep || !brokerPrep || !quantBoundary || !knowledgeLoop || !nextTask) return;

  section.setAttribute("data-state", "local_validation_complete_deferred_submission_not_started_external_gates_pending");
  section.setAttribute("data-readiness-matrix", "accepted_repository_local");
  section.setAttribute("data-goal-range", "0-15");
  section.setAttribute("data-local-beta", "accepted_repository_local");
  section.setAttribute("data-release-blockers", "visible");
  section.setAttribute("data-staging", "READONLY_CANDIDATE_RELEASED");
  section.setAttribute("data-production", "NO_GO");
  section.setAttribute("data-ios-physical-device", "OWNER_WAIVED_NONBLOCKING_FAILURE");
  section.setAttribute("data-broker", "FUTURE_READ_ONLY_PREPARATION_ONLY");
  section.setAttribute("data-real-account", "NOT_USED");
  section.setAttribute("data-quant", "RESEARCH_EVIDENCE_ONLY");
  section.setAttribute("data-next-local-task", "none");
  section.setAttribute("data-next-governance-task", "FULL-PROJECT-DEFERRED-GITHUB-SUBMISSION-1");
  section.setAttribute("data-next-boundary", "CORE-1B-LIVE-CURRENT-SOURCE");
  section.setAttribute("data-readonly-release", "COMPLETED");
  section.setAttribute("data-readonly-release-head", "f78ef83fbfc0096444d9996ec06c2b51efda5755");
  section.setAttribute("data-db-readonly-denial", "VERIFIED_SQLSTATE_25006");
  section.setAttribute("data-rollback-recovery", "VERIFIED");
  section.setAttribute("data-full-production-readiness", "NO_GO");
  section.setAttribute("data-local-validation", "COMPLETED");
  section.setAttribute("data-github-submission", "READY_NOT_STARTED");
  section.setAttribute("data-frozen-scope", "visible");

  renderList(topology, [
    "拓扑 1：候选标的 candidate overview / membership -> 研究画像与证据 -> 决策上下文；上下文只展示 quote freshness、research evidence、quant research evidence、portfolio omitted 或 Pingan historical-only 边界。",
    "拓扑 2：决策辅助 -> 人工检查 -> append-only review history -> 本地 decision note / local record -> follow-up；人工记录和本地草稿分开，local record 只在浏览器 localStorage 或 iOS UserDefaults 中按 source signature 保存。",
    "拓扑 3：Web 是 capability console，用来审计模块、来源、失败状态、release blockers；iOS 是 daily-use frontend，用来日常查看候选、上下文、人工复核、本地记录和 follow-up。",
    "拓扑 4：API / contracts 是 Web 和 iOS 的共同 wire source；非法 symbol、malformed payload、unauthorized、conflict、stale、missing、offline、source-mismatch 都必须 fail closed。",
    "拓扑 5：Pingan 只能 historical / last-imported，portfolio 在无权威实时来源时 omitted；quant 只能 research evidence，不能变成排序、建议、持仓、broker、订单、交易、现金、费用或仓位事实。",
    "拓扑 6：reviewed read-only candidate release 已完成；production promotion、broker、authoritative live portfolio、physical-device journey、legacy access、watcher、.ai-bridge、MCP、Cloudflare、automatic merge 仍是独立边界。"
  ], "ASSIST full-system Chinese topology is unavailable.");

  renderList(matrix, [
    "0. Local beta user acceptance: ACCEPT_LOCAL_BETA is recorded; non-local blockers remain visible.",
    "1. iOS daily use: selected candidate, evidence, local thoughts, and follow-up workflow are available through the mobile workspace.",
    "2. Web capability backend: Web is the system capability console, not an audit-only report page.",
    "3. Local records system: source-scoped local research/decision thoughts can be saved, loaded, and cleared only as browser/iOS unofficial records.",
    "4. Data-source authority boundary: historical snapshots, fixtures, missing data, and stale facts cannot become current holdings.",
    "5. Research evidence system: facts, gaps, conflicts, and source provenance are visible without buy/sell guidance.",
    "6. Portfolio-impact explanation: limited to risk/impact explanation; no portfolio management, sizing, allocation, or trading.",
    "7. Web/iOS semantic consistency: same candidate, evidence, and state meanings across clients with different presentation forms.",
    "8. Local reliability and developer experience: fixed local validation commands prove mainline and safety boundaries for large PRs.",
    "9. Release blocker dashboard: the reviewed read-only candidate release is complete while full production readiness remains NO_GO.",
    "10. Read-only release evidence: exact-head identity, GET-only smoke, SQLSTATE 25006 denial, backup, restore, rollback, and private ingress are verified.",
    "11. iOS device/Beta evidence: install and launch passed, but the owner-waived XCTest DTX bootstrap failure did not prove authentication, journey, or screenshots.",
    "12. Production preparation: production can become evaluable only through separate authorization, review, and PR; current state remains NO_GO.",
    "13. Broker/real-account preparation: any future broker phase starts read-only; no order, trade, or rebalancing authority.",
    "14. Low-frequency quant module: quant outputs may become research evidence only, never trading instructions.",
    "15. Long-term review and knowledge base: source-scoped Web/iOS local retrospective knowledge is complete with immutable history and no official or trading authority."
  ], "Full system 0-15 development matrix is unavailable.");
  renderList(readinessMatrix, [
    "已完成 completed：candidate overview / management、selected candidate bridge、decision-intake、decision context、advisory scope、human-review workspace、review history、follow-up、decision-note、Web localStorage local records、iOS UserDefaults local records、Web/iOS failure states、Pingan historical-only display、portfolio omitted boundary、facts freshness/provenance/authority、API write boundary、staging/release blocker preparation、production readiness assessment preparation、QUANT-1A 到 QUANT-1D 只读研究证据。",
    "已完成 completed：FULL-SYSTEM-GOAL-READINESS-MATRIX-1 已把 owner 计划、当前实现、测试证据、剩余缺口、未来授权门禁和冻结范围对齐到同一张中文拓扑和 readiness matrix。",
    "已完成 completed：ASSIST-1-LOCAL-REVIEW-KNOWLEDGE-LOOP-1 已把本地记录、复盘 ID 引用、证据缺口和流程经验沉淀为按来源隔离、不可变、可纠正替换的 Web/iOS 本地非官方知识。",
    "已完成 completed：reviewed head f78ef83fbfc0096444d9996ec06c2b51efda5755 的 read-only candidate release、GET-only smoke、SQLSTATE 25006 denial、backup/restore/rollback、private ingress 和 squash content equality 已验证。",
    "阻塞 blocked：approved authoritative live portfolio source、physical-device authentication/journey/screenshots、certificate hostname validation、official fact-source promotion 和 full production readiness 仍未完成。",
    "未来授权 future_authorized_only：broker read-only authority source、production readiness status change、full production promotion 和后续 merge/release 需要独立 owner 决策。",
    "冻结 frozen_forbidden：CodexPro local watcher、always-on Stage Runner watcher、ChatGPT-Codex automation enhancement、legacy access、.ai-bridge、MCP、Cloudflare tunnel/GPT settings、automatic Stage discovery、automatic merge、真实 broker 写入、真实订单和真实交易。",
    "安全边界 safety：production_status=NO_GO、real_trading=NOT_USED、broker_write=NOT_USED、official_portfolio_mutation=NOT_USED、ios_physical_device=OWNER_WAIVED_NONBLOCKING_FAILURE、codexpro_watcher_tasks=FROZEN。"
  ], "Full system readiness matrix is unavailable.");
  renderList(remainingGaps, [
    "产品主线 repository-local work：当前功能与 read-only release status parity 已完成；下一步仅做全量本地验证和审查。",
    "平台当前证据：released head f78ef83fbfc0096444d9996ec06c2b51efda5755 的 exact-head runtime、production GET-only smoke、DB denial、rollback/backup/recovery 和 private ingress 已验证；full production readiness 仍为 NO_GO。",
    "组合/持仓剩余 blocker：没有 approved authoritative live portfolio source 前，portfolio 继续 omitted，Pingan 继续 historical-only / last-imported，不进入 live risk impact。",
    "量化剩余边界：当前 QUANT-1D 已进入 decision context research evidence；任何真实 snapshot、正式研究结论、shadow portfolio 扩展或 read-only integration 加深都不能输出交易建议或影响候选排序。",
    "下一外部边界是 CORE-1B-LIVE-CURRENT-SOURCE；没有 approved continuously current portfolio authority 前继续 fail closed。"
  ], "Full system remaining gap classification is unavailable.");
  renderList(localBeta, [
    "Current achieved baseline: repository-local ASSIST-1 local beta is accepted and hardened through Web/iOS local product surfaces.",
    "Current incomplete scope is external or full-production only: authoritative portfolio authority, physical-device journey/screenshots, certificate hostname validation, and official fact-source promotion.",
    "Repository-local product completion does not change production NO_GO or convert missing external evidence into readiness."
  ], "Full system local beta status is unavailable.");
  renderList(releaseBlockers, [
    "Production release blocker: production remains NO_GO until a separate owner-authorized review and PR changes it.",
    "Read-only release status: exact reviewed runtime, GET-only smoke, database write denial, backup, restore, rollback, and private ingress are verified without official-fact mutation.",
    "Broker blocker: no broker or real-account connection is authorized; future first phase must be read-only only.",
    "Portfolio blocker: no authoritative live portfolio source is approved; Pingan remains historical-only and portfolio context can be omitted.",
    "iOS device blocker: install and launch passed, but the owner-waived XCTest DTX bootstrap failure did not prove authentication, the candidate-to-review journey, or screenshots.",
    "Certificate boundary: the known hostname mismatch remains unresolved and insecure release smoke is not certificate-validation evidence."
  ], "Release blocker dashboard is unavailable.");
  renderList(stagingPrep, [
    "Read-only candidate release is complete for exact reviewed head f78ef83fbfc0096444d9996ec06c2b51efda5755.",
    "GET-only routes, database SQLSTATE 25006 denial, backup, isolated restore, rollback, private ingress, and runtime identity are verified.",
    "Any future full-production promotion remains separate from this completed read-only release and keeps production NO_GO."
  ], "Staging preparation status is unavailable.");
  renderList(devicePrep, [
    "Physical-device install and launch passed for the recorded release lane.",
    "The owner-waived XCTest DTX bootstrap failure remains nonblocking but does not prove authentication, the candidate-to-review journey, or screenshots.",
    "No successful physical-device journey is claimed and no repeat is authorized by this local status update."
  ], "iOS device preparation status is unavailable.");
  renderList(productionPrep, [
    "Production preparation is evaluability-only: define what evidence would be required before NO_GO can change.",
    "The current deferred-upload local branch does not claim production readiness, deploy, switch runtime, write production facts, or touch production credentials.",
    "A production change requires explicit owner authorization, independent review, and a separate PR."
  ], "Production preparation status is unavailable.");
  renderList(brokerPrep, [
    "Broker/real-account preparation is future read-only-only scoping.",
    "No broker call, account login, unlock flow, order, trade, fill, cash, fee, position, allocation, sizing, or rebalance behavior exists here.",
    "Any future broker scope must prove read-only authority boundaries before any live account facts are displayed."
  ], "Broker preparation status is unavailable.");
  renderList(quantBoundary, [
    "Low-frequency quant remains a bounded research module, not the project axis.",
    "Quant output can only be research evidence with provenance, costs, next-day execution assumptions, and no instruction semantics.",
    "No quant result can become buy/sell/hold, ranking, scoring, target price, expected return, sizing, allocation, order, or trade."
  ], "Quant research boundary is unavailable.");
  renderList(knowledgeLoop, [
    "Long-term review and knowledge base are accepted at repository-local product evidence level.",
    "Knowledge entries preserve source identity, review ID references, local lessons, uncertainty, and immutable correction/replacement lineage without becoming official facts.",
    "Web localStorage and iOS UserDefaults knowledge remains local-only with no API upload, database write, official-review mutation, portfolio authority, broker action, or trading instruction."
  ], "Knowledge loop status is unavailable.");
  renderList(nextTask, [
    "Completed repository-local task: CORE-ASSIST-LOCAL-RECORDS-DRAFTS-HARDENING-1.",
    "Completed repository-local task: CORE-ASSIST-WEB-CAPABILITY-CONSOLE-HARDENING-1.",
    "Completed repository-local task: ASSIST-1-LOCAL-REVIEW-KNOWLEDGE-LOOP-1.",
    "Local validation and final review are complete. Next governance task: FULL-PROJECT-DEFERRED-GITHUB-SUBMISSION-1; submission has not started and production remains NO_GO."
  ], "Full system next task is unavailable.");
}

function ensureAssistFullSystemDevelopmentConsolePanel(): void {
  if (document.getElementById("assist-full-system-0-15-development-console")) return;
  const host = document.getElementById("assist-full-local-beta-console")
    ?? document.getElementById("assist-local-beta-product-split-console")
    ?? document.getElementById("assist-pre-device-local-beta-rc-gate")
    ?? document.getElementById("assist-decision-note-workflow")
    ?? document.getElementById("assist-review-follow-up-workflow")
    ?? document.getElementById("assist-human-review-workspace")
    ?? document.getElementById("assist-advisory-scope")
    ?? document.getElementById("candidate-decision-intake")
    ?? document.getElementById("candidate-memberships");
  if (!host?.parentElement) return;
  const section = document.createElement("section");
  section.id = "assist-full-system-0-15-development-console";
  section.className = "assist-full-system-0-15-development-console";
  section.dataset.testid = "assist-full-system-0-15-development-console";
  section.setAttribute("aria-label", "ASSIST full system 0-15 development console");
  section.innerHTML = [
    "<div class=\"section-heading\">",
    "<h2>ASSIST full system 0-15 development</h2>",
    "</div>",
    "<h3>中文系统拓扑</h3>",
    "<ul id=\"assist-full-system-cn-topology\" data-testid=\"assist-full-system-cn-topology\"></ul>",
    "<h3>0-15 development matrix</h3>",
    "<ul id=\"assist-full-system-0-15-development-matrix\" data-testid=\"assist-full-system-0-15-development-matrix\"></ul>",
    "<h3>Readiness matrix</h3>",
    "<ul id=\"assist-full-system-readiness-matrix\" data-testid=\"assist-full-system-readiness-matrix\"></ul>",
    "<h3>Remaining gaps</h3>",
    "<ul id=\"assist-full-system-remaining-gaps\" data-testid=\"assist-full-system-remaining-gaps\"></ul>",
    "<h3>Local beta status</h3>",
    "<ul id=\"assist-full-system-local-beta-status\" data-testid=\"assist-full-system-local-beta-status\"></ul>",
    "<h3>Release blocker dashboard</h3>",
    "<ul id=\"assist-release-blocker-dashboard\" data-testid=\"assist-release-blocker-dashboard\"></ul>",
    "<h3>Staging preparation</h3>",
    "<ul id=\"assist-staging-preparation-status\" data-testid=\"assist-staging-preparation-status\"></ul>",
    "<h3>iOS device and Beta preparation</h3>",
    "<ul id=\"assist-ios-device-preparation-status\" data-testid=\"assist-ios-device-preparation-status\"></ul>",
    "<h3>Production preparation</h3>",
    "<ul id=\"assist-production-preparation-status\" data-testid=\"assist-production-preparation-status\"></ul>",
    "<h3>Broker read-only preparation</h3>",
    "<ul id=\"assist-broker-readonly-preparation-status\" data-testid=\"assist-broker-readonly-preparation-status\"></ul>",
    "<h3>Quant research boundary</h3>",
    "<ul id=\"assist-quant-research-boundary-status\" data-testid=\"assist-quant-research-boundary-status\"></ul>",
    "<h3>Long-term knowledge loop</h3>",
    "<ul id=\"assist-knowledge-loop-status\" data-testid=\"assist-knowledge-loop-status\"></ul>",
    "<h3>Next local task</h3>",
    "<ul id=\"assist-full-system-next-task\" data-testid=\"assist-full-system-next-task\"></ul>"
  ].join("");
  attachOperatorDiagnosticPanel(host, section);
}

function renderCoreAssistLoopClosureCheckpointPanel(context: CoreAssistStatusPanelsRenderContext): void {
  const { data, busy, candidateMemberships, membershipBusy, decisionIntake, assistAdvisoryScope, assistAdvisoryScopeBusy, assistHumanReviewWorkspace, assistHumanReviewWorkspaceBusy, assistReviewFollowUpWorkflow, assistReviewFollowUpWorkflowBusy, assistDecisionNoteWorkflow, assistDecisionNoteWorkflowBusy } = context;
  if (typeof document === "undefined") return;
  ensureCoreAssistLoopClosureCheckpointPanel();
  const section = document.getElementById("core-assist-loop-closure-checkpoint");
  const path = document.getElementById("core-assist-loop-closure-path");
  const stateBoundaries = document.getElementById("core-assist-loop-closure-state-boundaries");
  const localRecords = document.getElementById("core-assist-loop-closure-local-records");
  const reviewFollowUp = document.getElementById("core-assist-loop-closure-review-follow-up");
  const validation = document.getElementById("core-assist-loop-closure-validation");
  const safety = document.getElementById("core-assist-loop-closure-safety");
  const failureMatrix = document.getElementById("core-assist-web-ios-failure-state-unification");
  const failurePolicy = document.getElementById("core-assist-web-ios-failure-state-policy");
  const currentFailureSummary = document.getElementById("core-assist-web-current-unified-failure-state-summary");
  const currentMetadataPolicy = document.getElementById("core-assist-web-current-unified-failure-state-metadata-policy");
  if (
    !section || !path || !stateBoundaries || !localRecords || !reviewFollowUp || !validation || !safety
    || !failureMatrix || !failurePolicy || !currentFailureSummary || !currentMetadataPolicy
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

  section.setAttribute("data-state", "core_assist_loop_closure_checkpoint");
  section.setAttribute("data-next-local-task", "none");
  section.setAttribute("data-next-governance-task", "FULL-PROJECT-DEFERRED-GITHUB-SUBMISSION-1");
  section.setAttribute("data-next-boundary", "CORE-1B-LIVE-CURRENT-SOURCE");
  section.setAttribute("data-local-validation", "COMPLETED");
  section.setAttribute("data-github-submission", "READY_NOT_STARTED");
  section.setAttribute("data-product-mode", "owner_authorized_goal_pursuit");
  section.setAttribute("data-web-role", "capability_console");
  section.setAttribute("data-ios-role", "daily_use_frontend");
  section.setAttribute("data-production", "NO_GO");
  section.setAttribute("data-real-trading", "NOT_USED");
  section.setAttribute("data-broker-write", "NOT_USED");
  section.setAttribute("data-official-portfolio-mutation", "NOT_USED");
  section.setAttribute("data-ios-physical-device", "OWNER_WAIVED_NONBLOCKING_FAILURE");

  renderList(path, [
    "Completed tasks: CORE-ASSIST-LOOP-E2E-CLOSURE-1, CORE-ASSIST-WEB-IOS-FAILURE-STATE-UNIFICATION-1, CORE-ASSIST-LOCAL-RECORDS-DRAFTS-HARDENING-1, and CORE-ASSIST-IOS-DAILY-USE-FRONTEND-HARDENING-1.",
    "Completed task: CORE-ASSIST-WEB-CAPABILITY-CONSOLE-HARDENING-1.",
    "Completed tasks include ASSIST-1-LOCAL-REVIEW-KNOWLEDGE-LOOP-1, the reviewed read-only candidate release, and full local validation/final review; CORE-1B-LIVE-CURRENT-SOURCE remains externally blocked.",
    "Visible path: selected candidate -> research context -> decision context -> decision intake -> advisory scope -> human-review workspace -> local record -> post-decision review -> follow-up.",
    "Candidate bridge status is exact-symbol and membership-state based; missing, archived, unauthorized, conflict, stale, malformed, offline, unavailable, source-mismatch, or no-selected-candidate states stay explicit."
  ], "CORE-ASSIST closure path is unavailable.");
  renderList(stateBoundaries, [
    "Quote freshness, research evidence, portfolio omitted, and Pingan historical-only metadata remain visible before any local human review is used.",
    "Stale context, malformed payload, illegal symbol, unauthorized read, conflict, offline, and unavailable paths must not be displayed as fresh or empty success.",
    "Fixture, local, historical-only, and research evidence remain labelled and cannot become live holdings or authoritative portfolio facts."
  ], "CORE-ASSIST state boundaries are unavailable.");
  renderList(failureMatrix, [
    "Unified loading: current facts are pending; stale success facts, local drafts, local records, and busy/request state stay hidden until the current source settles.",
    "Unified empty: an authenticated source returned no items; it is not unauthorized, not unavailable, and not reused as stale success.",
    "Unified stale: source metadata is visible as stale or historical-only; stale quote, research, Pingan, or portfolio facts are never displayed as fresh.",
    "Unified unavailable: source cannot provide a valid envelope; source metadata for facts is absent and stale facts, drafts, and records are cleared.",
    "Unified unauthorized: authorization failed and must never be rendered as an empty success list.",
    "Unified conflict: source reported incompatible identity, version, or state; the reason stays visible and old success facts are not reused.",
    "Unified offline: only local-only capability remains visible; no network success, broker authority, or official record is implied.",
    "Unified malformed: symbol, route, payload, or response shape failed validation; client fallback submission is blocked.",
    "Unified fixture-unavailable: repository-local fixture/demo data is absent or invalid; it is labelled as fixture and never promoted to real facts.",
    "Unified source-mismatch: selected candidate, membership, workflow, quote, research, or source signature differs; source-scoped local records stay hidden."
  ], "CORE-ASSIST Web/iOS failure-state unification matrix is unavailable.");
  renderList(failurePolicy, [
    "Policy loading: hide facts, local drafts, local records, and busy/request residue; source metadata waits for the current response.",
    "Policy empty: show only authenticated empty-source metadata; keep local records hidden unless a current source signature is available.",
    "Policy stale: show source/as-of/fetched metadata with stale or historical-only wording; block fresh interpretation and current-risk authority.",
    "Policy unavailable: clear stale facts, drafts, records, and source-scoped actions; metadata is not synthesized.",
    "Policy unauthorized: authorization failure remains visible, clears stale success, and never replaces the failure with an empty list.",
    "Policy conflict: show the conflicting identity, version, or state reason; older success facts are not reused.",
    "Policy offline: expose local-only capability boundaries and hide network success, official records, broker authority, and fresh facts.",
    "Policy malformed: block client fallback submission, hide stale success, and keep validation failure visible.",
    "Policy fixture-unavailable: disclose fixture/demo absence, keep it non-real, and does not promote sample facts.",
    "Policy source-mismatch: hide facts and source-scoped local records until selected candidate, membership, workflow, quote, research, and source signature match."
  ], "CORE-ASSIST Web/iOS failure-state enforcement policy is unavailable.");
  renderList(currentFailureSummary, coreAssistUnifiedFailureStateSummaryForUiStates([
    ["decisionIntake", decisionBridge.state],
    ["decisionContext", decisionContextBridge.state],
    ["advisoryScope", advisoryBridge.state],
    ["humanReviewWorkspace", humanReviewBridge.state],
    ["followUpWorkflow", followUpBridge.state],
    ["decisionNoteWorkflow", decisionNoteBridge.state]
  ], busy || membershipBusy || assistAdvisoryScopeBusy || assistHumanReviewWorkspaceBusy || assistReviewFollowUpWorkflowBusy || assistDecisionNoteWorkflowBusy), "CORE-ASSIST current unified failure-state summary is unavailable.");
  renderList(currentMetadataPolicy, coreAssistUnifiedFailureStateMetadataPolicyForUiStates([
    ["decisionIntake", decisionBridge.state],
    ["decisionContext", decisionContextBridge.state],
    ["advisoryScope", advisoryBridge.state],
    ["humanReviewWorkspace", humanReviewBridge.state],
    ["followUpWorkflow", followUpBridge.state],
    ["decisionNoteWorkflow", decisionNoteBridge.state]
  ], busy || membershipBusy || assistAdvisoryScopeBusy || assistHumanReviewWorkspaceBusy || assistReviewFollowUpWorkflowBusy || assistDecisionNoteWorkflowBusy), "CORE-ASSIST current unified failure-state metadata policy is unavailable.");
  renderList(localRecords, [
    "Local records are source-scoped browser localStorage or iOS UserDefaults only.",
    "Source-signature mismatch, unavailable source facts, malformed records, or unsafe saved envelopes hide saved thoughts instead of reusing stale records.",
    "Local drafts and records stay unofficial and are not uploaded to any API, not written to any database, not server persisted, not sent, not official review history, not portfolio facts, and not broker synced."
  ], "CORE-ASSIST local-record status is unavailable.");
  renderList(reviewFollowUp, [
    "Human-check writes remain idempotent, and review history remains append-only after successful refresh.",
    "Post-decision review and follow-up workflow display unresolved evidence gaps, later-review markers, and local note context without creating official trading direction.",
    "Old records that lack snapshot authority remain disclosed or hidden fail-closed; missing snapshots are not fabricated."
  ], "CORE-ASSIST review and follow-up status is unavailable.");
  renderList(validation, [
    "Review checkpoint requires project-state verify, build, typecheck, lint, test, contract-test, mainline health check, and iOS Gate B DTO/UI smoke.",
    "The deferred-upload product-mainline branch completed local validation and final review with no current PR; one GitHub submission is ready but has not started.",
    "The current review package verifies the completed read-only candidate release and recovery evidence while keeping full production NO_GO, CORE-1B live-current-source blocked, and all new broker, physical-device, or frozen-automation actions disabled."
  ], "CORE-ASSIST validation status is unavailable.");
  renderList(safety, [
    "Safety boundary: production_status=NO_GO, real_trading=NOT_USED, broker_write=NOT_USED, official_portfolio_mutation=NOT_USED, ios_physical_device=OWNER_WAIVED_NONBLOCKING_FAILURE; authentication, candidate journey, and screenshots are NOT_PROVEN.",
    "Frozen scope remains untouched: .ai-bridge, CodexPro watcher, always-on Stage Runner watcher, MCP, Cloudflare, ChatGPT GPT settings, automatic Stage discovery, and automatic merge.",
    "No recommendation, ranking, scoring, buy/sell/hold instruction, target price, stop loss, take profit, expected return, timing, sizing, allocation, order, trade, fill, cash, fee, or position mutation is introduced."
  ], "CORE-ASSIST safety status is unavailable.");
}

function ensureCoreAssistLoopClosureCheckpointPanel(): void {
  if (document.getElementById("core-assist-loop-closure-checkpoint")) return;
  const host = document.getElementById("assist-full-system-0-15-development-console")
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
  section.id = "core-assist-loop-closure-checkpoint";
  section.className = "core-assist-loop-closure-checkpoint";
  section.dataset.testid = "core-assist-loop-closure-checkpoint";
  section.setAttribute("aria-label", "CORE ASSIST loop closure checkpoint");
  section.innerHTML = [
    "<div class=\"section-heading\">",
    "<h2>CORE-ASSIST loop closure checkpoint</h2>",
    "</div>",
    "<h3>Candidate to follow-up path</h3>",
    "<ul id=\"core-assist-loop-closure-path\" data-testid=\"core-assist-loop-closure-path\"></ul>",
    "<h3>Facts and failure boundaries</h3>",
    "<ul id=\"core-assist-loop-closure-state-boundaries\" data-testid=\"core-assist-loop-closure-state-boundaries\"></ul>",
    "<h3>Web/iOS failure-state unification</h3>",
    "<ul id=\"core-assist-web-ios-failure-state-unification\" data-testid=\"core-assist-web-ios-failure-state-unification\"></ul>",
    "<h3>Web/iOS failure-state policy</h3>",
    "<ul id=\"core-assist-web-ios-failure-state-policy\" data-testid=\"core-assist-web-ios-failure-state-policy\"></ul>",
    "<h3>Current unified failure-state summary</h3>",
    "<ul id=\"core-assist-web-current-unified-failure-state-summary\" data-testid=\"core-assist-web-current-unified-failure-state-summary\"></ul>",
    "<h3>Current unified failure-state metadata policy</h3>",
    "<ul id=\"core-assist-web-current-unified-failure-state-metadata-policy\" data-testid=\"core-assist-web-current-unified-failure-state-metadata-policy\"></ul>",
    "<h3>Local records and drafts</h3>",
    "<ul id=\"core-assist-loop-closure-local-records\" data-testid=\"core-assist-loop-closure-local-records\"></ul>",
    "<h3>Review history and follow-up</h3>",
    "<ul id=\"core-assist-loop-closure-review-follow-up\" data-testid=\"core-assist-loop-closure-review-follow-up\"></ul>",
    "<h3>Validation checkpoint</h3>",
    "<ul id=\"core-assist-loop-closure-validation\" data-testid=\"core-assist-loop-closure-validation\"></ul>",
    "<h3>Safety boundary</h3>",
    "<ul id=\"core-assist-loop-closure-safety\" data-testid=\"core-assist-loop-closure-safety\"></ul>"
  ].join("");
  attachOperatorDiagnosticPanel(host, section);
}
