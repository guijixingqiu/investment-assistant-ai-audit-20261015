import { existsSync, readFileSync } from "node:fs";

export const GOAL_ID = "HOLDING-EVIDENCE-RESEARCH-BETA-V1";
export const GOAL_BRANCH = "codex/holding-evidence-research-beta-v1";
export const BASE_MAIN_SHA = "f732ca8a56031683e5ffb0923e58533686881361";
export const PR155_BASE_MAIN_SHA = "77c0137455551b5069b7606cce4f8c3ed211c074";
export const NEXT_TASK_ACTIVATION_CONDITION = "pr_155_squash_merged_and_fresh_main_verified";
export const NEXT_TASK_PENDING_ACTIVATION = "pending_pr_155_squash_merge";
export const NEXT_TASK_SATISFIED_ACTIVATION = "pr_155_squash_merged_fresh_main_verified";
export const MILESTONE_IDS = Object.freeze(["E0", "E1", "E2", "E3", "E4", "E5", "E6", "E7"]);
export const MILESTONE_TITLES = Object.freeze({
  E0: "User material frozen evidence deep-research gate and user confirmation",
  E1: "Holding and research-stock information event loop",
  E2: "Geely comparable new-energy sales monitor",
  E3: "GCL photovoltaic value-chain price monitor",
  E4: "Today decision tracking and Web/iOS fact-version parity",
  E5: "Research quality source health and optional second-opinion evaluation",
  E6: "Fourteen-day Local Beta historical replay and migration/exit decisions",
  E7: "Full validation exact-head review and owner submission checkpoint"
});
export const REQUIRED_ALLOWED_PATH_PREFIXES = Object.freeze([
  "AGENTS.md",
  "ARCHITECTURE_BASELINE.yaml",
  "CHANGELOG.md",
  "PROJECT_STATE.yaml",
  "QUALITY_GATES.yaml",
  "README.md",
  "ROADMAP.yaml",
  "package.json",
  "db/migrations/",
  "packages/contracts/",
  "apps/api/",
  "apps/ios/AnnualRingsGateA/",
  "apps/web/",
  "config/research-monitors/",
  "scripts/architecture-",
  "scripts/ci-risk-scan.mjs",
  "scripts/deep-research-",
  "scripts/gate-b-verify.mjs",
  "scripts/holding-event-",
  "scripts/ios-gate-b-",
  "scripts/geely-sales-",
  "scripts/gcl-price-",
  "scripts/today-",
  "scripts/product-goal-check.mjs",
  "scripts/production-takeover-boundary-check.mjs",
  "scripts/web-core-journey-ui-smoke.mjs",
  "scripts/lib/product-goal-check.mjs",
  "tests/"
]);

// Historical helper retained because the read-only CLI still scans old Stage 19 paths safely.
export const STAGE19_FINAL_SOURCE_ROOT = "artifacts/stage-13-20/real-data-quant/evidence/";

// Historical HOLDING-EVIDENCE-RESEARCH-BETA-V1 evaluator only. It verifies the
// completed goal's archived client shape and must never define the active F1
// product target.
export function evaluateHistoricalHoldingGoal({
  projectState,
  changedPaths = [],
  addedLinesByPath = new Map(),
  fileExists = existsSync,
  readFile = (path) => readFileSync(path, "utf8")
}) {
  const failures = [];
  const contract = section(
    projectState,
    "prior_holding_evidence_research_goal",
    "prior_full_system_local_goal"
  );
  const milestones = parseMilestones(section(contract, "  milestones", "  active_local_milestones"));
  const statusById = Object.fromEntries(milestones.map(({ id, status }) => [id, status]));
  const goalStatus = scalar(contract, "status");

  requireScalar(contract, "mode", "OWNER_AUTHORIZED_PRODUCT_MAINLINE_GOAL_PURSUIT", failures, "mode_mismatch");
  requireScalar(contract, "goal_id", GOAL_ID, failures, "goal_id_mismatch");
  requireScalar(contract, "branch", GOAL_BRANCH, failures, "branch_mismatch");
  requireScalar(contract, "base_main_sha", BASE_MAIN_SHA, failures, "base_main_sha_mismatch");
  requireScalar(contract, "formal_checkout_policy", "untouched", failures, "formal_checkout_policy_mismatch");
  requireScalar(contract, "github_policy", "pr_154_squash_merged_retired_branch_no_further_push", failures, "github_policy_mismatch");
  requireInlineList(contract, "milestone_sequence", MILESTONE_IDS, failures, "milestone_sequence_mismatch");
  validateMilestones(milestones, failures);
  const progress = validateSequentialProgress(statusById, failures);
  const expectedGoalStatus = progress.complete ? "completed_squash_merged_mainline" : "active_local_development";
  if (goalStatus !== expectedGoalStatus) failures.push({ reason: "goal_status_mismatch", actual: goalStatus, expected: expectedGoalStatus });
  requireInlineList(contract, "active_local_milestones", progress.active, failures, "active_local_milestones_mismatch");
  requireInlineList(contract, "completed_local_milestones", progress.completed, failures, "completed_local_milestones_mismatch");
  requireInlineList(contract, "remaining_local_milestones", progress.remaining, failures, "remaining_local_milestones_mismatch");

  const github = section(contract, "  github_submission", "  safety");
  requireScalar(github, "status", "squash_merged", failures, "github_submission_status_mismatch");
  requireScalar(github, "push_count", "2", failures, "github_push_count_mismatch");
  requireScalar(github, "pull_request", "154", failures, "github_pull_request_mismatch");
  requireScalar(github, "initial_reviewed_head", "194ebc53bfdec379b3c367a48732ed78526aec9d", failures, "github_initial_reviewed_head_mismatch");
  requireScalar(github, "initial_review_outcome", "five_p2_changes_required", failures, "github_initial_review_outcome_mismatch");
  requireScalar(github, "repair_scope", "same_branch_same_pr_ordinary_commits", failures, "github_repair_scope_mismatch");
  requireScalar(github, "final_reviewed_head", "b81923303c3285eb6d8e6dcf6bb36b7850e5a6e4", failures, "github_final_reviewed_head_mismatch");
  requireScalar(github, "final_review_outcome", "passed_no_unresolved_p1_or_p2", failures, "github_final_review_outcome_mismatch");
  requireScalar(github, "merge_method", "squash", failures, "github_merge_method_mismatch");
  requireScalar(github, "merged_main_sha", "77c0137455551b5069b7606cce4f8c3ed211c074", failures, "github_merged_main_mismatch");
  requireScalar(github, "reviewed_and_merged_content_tree", "a5f53c4ca2a394fb09b8873ada369691e855207e", failures, "github_content_tree_mismatch");
  requireScalar(github, "post_merge_ci", "node_checks_and_risk_scan_passed_run_30150518008", failures, "github_post_merge_ci_mismatch");
  requireScalar(github, "next_authority", "owner_authorized_real_local_beta_input_baseline", failures, "github_next_authority_mismatch");

  const safety = section(contract, "  safety", "prior_full_system_local_goal");
  for (const [key, expected] of Object.entries({
    advisory_only: "true",
    production_status: "NO_GO",
    real_trading: "forbidden",
    broker_access: "forbidden",
    trading_credentials: "forbidden",
    production_access: "forbidden",
    production_writes: "forbidden",
    official_fact_mutation: "forbidden",
    deployment: "forbidden",
    physical_device: "forbidden",
    auto_merge: "forbidden",
    merge: "separate_exact_owner_authorization_required",
    legacy_repository: "forbidden",
    ai_bridge: "DO_NOT_READ_MODIFY_DELETE_OR_COMMIT"
  })) requireScalar(safety, key, expected, failures, `safety_${key}_mismatch`);

  for (const path of changedPaths) {
    if (path.split("/").includes(".ai-bridge")) failures.push({ reason: "ai_bridge_path_forbidden", path });
    else if (!REQUIRED_ALLOWED_PATH_PREFIXES.some((prefix) => path === prefix || prefix.endsWith("/") && path.startsWith(prefix)
      || !prefix.endsWith("/") && prefix.includes("-") && path.startsWith(prefix))) failures.push({ reason: "changed_path_outside_goal", path });
  }

  const nextTask = section(projectState, "next_task", "prior_v2_next_task");
  const expectedNext = progress.complete ? "REAL-LOCAL-BETA-INPUT-BASELINE-1" : progress.active[0];
  requireScalar(nextTask, "id", expectedNext, failures, "next_task_id_mismatch");
  requireScalar(nextTask, "boundary_kind", "OWNER_AUTHORIZED_LOCAL_PRODUCT_DEVELOPMENT", failures, "next_task_boundary_mismatch");
  const nextTaskExecutable = progress.complete ? validateNextTaskActivation(nextTask, failures) : true;
  requireScalar(nextTask, "status", progress.complete
    ? nextTaskExecutable ? "READY_NOT_STARTED" : "QUEUED_PENDING_PR_155_MERGE"
    : "IN_PROGRESS", failures, "next_task_status_mismatch");
  requireScalar(nextTask, "executable_local_task", String(nextTaskExecutable), failures, "next_task_executable_mismatch");

  verifyHistoricalHoldingClientShape(fileExists, readFile, failures);
  for (const [path, lines] of addedLinesByPath) {
    if (!path.startsWith("apps/ios/AnnualRingsGateA/") || /\/(?:Tests|UITests)\//.test(path)) continue;
    if (/\b(?:submitOrder|brokerLogin|buySignal|sellSignal|tradeSignal|recommendedAction|targetPosition)\b/.test(lines)) {
      failures.push({ reason: "forbidden_ios_trading_or_recommendation_semantics", path });
    }
  }

  return {
    ok: failures.length === 0,
    goalId: scalar(contract, "goal_id"),
    goalStatus,
    branch: scalar(contract, "branch"),
    baseMainSha: scalar(contract, "base_main_sha"),
    milestoneStatuses: statusById,
    nextTask: scalar(nextTask, "id"),
    nextTaskExecutable,
    nextTaskActivationStatus: scalar(nextTask, "activation_status"),
    githubSubmissionStatus: scalar(github, "status"),
    changedPaths,
    semanticAlignment: failures.length === 0 ? "aligned" : "drifted",
    failures
  };
}

function validateNextTaskActivation(nextTask, failures) {
  requireScalar(nextTask, "activation_condition", NEXT_TASK_ACTIVATION_CONDITION, failures, "next_task_activation_condition_mismatch");
  requireScalar(nextTask, "activation_pull_request", "155", failures, "next_task_activation_pr_mismatch");
  const status = scalar(nextTask, "activation_status");
  const mergedMainSha = scalar(nextTask, "activation_merged_main_sha");
  const freshMainSha = scalar(nextTask, "activation_fresh_main_sha");

  if (status === NEXT_TASK_PENDING_ACTIVATION) {
    for (const [key, actual, expected] of [
      ["merged_main_sha", mergedMainSha, "none"],
      ["fresh_main_sha", freshMainSha, "none"]
    ]) {
      if (actual !== expected) failures.push({ reason: `next_task_pending_activation_${key}_mismatch`, actual, expected });
    }
    return false;
  }
  if (status !== NEXT_TASK_SATISFIED_ACTIVATION) {
    failures.push({ reason: "next_task_activation_status_mismatch", actual: status });
    return false;
  }

  let ready = true;
  if (!/^[0-9a-f]{40}$/.test(mergedMainSha ?? "")) {
    failures.push({ reason: "next_task_activation_merge_sha_invalid", actual: mergedMainSha });
    ready = false;
  }
  if (mergedMainSha === PR155_BASE_MAIN_SHA) {
    failures.push({ reason: "next_task_activation_merge_sha_is_pr_155_base", actual: mergedMainSha });
    ready = false;
  }
  if (freshMainSha !== mergedMainSha) {
    failures.push({ reason: "next_task_activation_fresh_main_mismatch", actual: freshMainSha, expected: mergedMainSha });
    ready = false;
  }
  return ready;
}

function validateMilestones(milestones, failures) {
  const ids = milestones.map(({ id }) => id);
  if (!sameArray(ids, MILESTONE_IDS)) failures.push({ reason: "milestone_definitions_mismatch", actual: ids });
  if (new Set(ids).size !== ids.length) failures.push({ reason: "duplicate_milestone_id", actual: ids });
  for (const milestone of milestones) {
    if (MILESTONE_TITLES[milestone.id] !== milestone.title) failures.push({ reason: "milestone_title_mismatch", id: milestone.id, actual: milestone.title });
  }
}

function validateSequentialProgress(statusById, failures) {
  const completed = [];
  let active = [];
  let pendingStarted = false;
  for (const id of MILESTONE_IDS) {
    const status = statusById[id];
    if (!pendingStarted && status === "completed_local") { completed.push(id); continue; }
    if (!pendingStarted && status === "in_progress") { active = [id]; pendingStarted = true; continue; }
    pendingStarted = true;
    if (status !== "pending") failures.push({ reason: "milestone_status_not_sequential", id, actual: status });
  }
  const complete = completed.length === MILESTONE_IDS.length;
  if (!complete && active.length !== 1) failures.push({ reason: "active_milestone_count", actual: active.length, expected: 1 });
  return { complete, completed, active, remaining: MILESTONE_IDS.slice(completed.length) };
}

function verifyHistoricalHoldingClientShape(fileExists, readFile, failures) {
  const ringsPath = "apps/ios/AnnualRingsGateA/App/AnnualDecisionRingsView.swift";
  const appPath = "apps/ios/AnnualRingsGateA/App/AnnualRingsGateAApp.swift";
  if (!fileExists(ringsPath) || !fileExists(appPath)) { failures.push({ reason: "preserved_year_ring_or_app_missing" }); return; }
  const rings = readFile(ringsPath);
  const app = readFile(appPath);
  for (const token of ["case candidate", "case evidence", "case portfolio", "case decision", "case review"]) {
    if (!rings.includes(token)) failures.push({ reason: "five_layer_year_ring_changed", token });
  }
  if (!app.includes("GateAMarketScreen") || !app.includes("GateBResearchScreen")) failures.push({ reason: "quote_assisted_decision_dual_entry_changed" });
}

function parseMilestones(content) {
  return [...content.matchAll(/^    - id:\s*(\S+)\n([\s\S]*?)(?=^    - id:|(?![\s\S]))/gm)].map((match) => ({
    id: match[1], title: scalar(match[2], "title"), status: scalar(match[2], "status")
  }));
}
function section(content, startKey, endKey) { const start = content.indexOf(`${startKey}:`); if (start < 0) return ""; const end = content.indexOf(`\n${endKey}:`, start + startKey.length + 1); return content.slice(start, end < 0 ? content.length : end); }
function scalar(content, key) { return content.match(new RegExp(`^\\s*${escapeRegExp(key)}:\\s*([^\\n]+)$`, "m"))?.[1]?.trim() ?? null; }
function inlineList(content, key) { const raw = scalar(content, key); return raw?.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1).split(",").map((value) => value.trim()).filter(Boolean) : []; }
function requireScalar(content, key, expected, failures, reason) { const actual = scalar(content, key); if (actual !== expected) failures.push({ reason, actual, expected }); }
function requireInlineList(content, key, expected, failures, reason) { const actual = inlineList(content, key); if (!sameArray(actual, expected)) failures.push({ reason, actual, expected }); }
function sameArray(actual, expected) { return actual.length === expected.length && expected.every((value, index) => actual[index] === value); }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
