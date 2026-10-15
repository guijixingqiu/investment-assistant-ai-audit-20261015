#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { TextDecoder } from "node:util";
import { readStageRunLockStatus } from "./codex-stage-run-lock.mjs";
import {
  REAL_DATA_QUANT_FILES,
  sha256,
  validateRealDataQuantSourceBundle
} from "./lib/real-data-quant-evidence.mjs";
import {
  STAGE19_FINAL_SOURCE_ROOT
} from "./lib/product-goal-check.mjs";

const IOS_DRIFT_SCAN_PREFIX = "apps/ios/AnnualRingsGateA/";
export const IOS_UNTRACKED_SCAN_MAX_BYTES = 1_048_576;
export const STAGE19_SOURCE_SECTION_MAX_BYTES = 1_048_576;
export const STAGE19_BUNDLE_FILE_MAX_BYTES = 8 * 1_048_576;
const GIT_OUTPUT_MAX_BYTES = 4_194_304;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
// Kept export name for existing callers; validates current state relationships.
export function evaluateProductRecoveryRebaselineState({
  projectState, changedPaths = [], addedLinesByPath = new Map(),
  currentHeadSha = null, currentBranch = null, externalReviewedHeadSha = null,
  requireExactHeadReview = false, worktreeClean = null, stageEnvelopeValidated = false,
}) {
  const failures = [];
  let state;
  try { state = JSON.parse(projectState); }
  catch { return { ok: false, failures: [{ reason: "invalid_project_state_json" }] }; }
  if (state.project_controller_handoff) {
    // Public pure callers can inspect structure, never supply their own I/O provenance.
    return evaluateControllerTaskState({ state, changedPaths, addedLinesByPath, context: null, invocation: {} });
  }
  const goal = state?.local_goal ?? {};
  const next = state?.next_task ?? {};
  const validSha = (value) => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
  const text = (value) => typeof value === "string" && value.trim().length > 0;
  const fail = (reason, actual) => failures.push({ reason, actual });
  if (state?.schema_version !== 2 || state?.project !== "investment-assistant-system" ||
      state?.repository !== "guijixingqiu/investment-assistant-system") fail("project_identity_or_schema_invalid");
  if (!["active", "paused", "completed"].includes(state?.status)) fail("project_status_invalid", state?.status);
  if (state?.status === "completed" && goal.status !== "completed") fail("project_completion_without_goal_completion");
  for (const key of ["goal_id", "branch", "delivery_unit", "authorization"])
    if (!text(goal[key])) fail("goal_field_missing", key);
  for (const key of ["base_main_sha", "source_head_sha"])
    if (!validSha(goal[key])) fail("goal_sha_invalid", key);
  if (!["owner_authorized_local", "owner_authorized_goal_pursuit", "stage_runner"].includes(goal.mode)) fail("goal_mode_invalid", goal.mode);
  if (goal.mode === "stage_runner" && !stageEnvelopeValidated) fail("stage_envelope_validation_required");
  if (!["in_progress", "review_ready", "completed", "blocked", "paused"].includes(goal.status)) fail("goal_status_invalid", goal.status);
  if (!["local_only", "publication_authorized"].includes(goal.publication)) fail("publication_policy_invalid");
  if (goal.pull_request !== null && (!Number.isSafeInteger(goal.pull_request) || goal.pull_request < 1)) fail("pull_request_invalid");
  if (currentBranch !== null && currentBranch !== goal.branch) fail("goal_branch_mismatch", currentBranch);
  if (next.goal_id !== goal.goal_id || !text(next.action)) fail("next_task_relation_invalid");
  if (goal.advisory_only !== true || goal.production_status !== "NO_GO") fail("unsafe_product_boundary");
  if (state?.history?.executable !== false) fail("history_must_be_non_executable");
  if (!Array.isArray(goal.acceptance_criteria) || !goal.acceptance_criteria.length || !goal.acceptance_criteria.every(text)) fail("acceptance_criteria_missing");
  const canonicalPath = (path) => typeof path === "string" && path.length > 0 &&
    !path.startsWith("/") && !path.includes("\\") && !path.split("/").some((part, i, parts) =>
      part === "." || part === ".." || (part === "" && i !== parts.length - 1));
  const allowed = goal.allowed_paths;
  if (!Array.isArray(allowed) || !allowed.length || !allowed.every(canonicalPath)) fail("allowed_paths_invalid");
  for (const path of changedPaths) {
    if (path.split("/").includes(".ai-bridge")) failures.push({ reason: "ai_bridge_path_forbidden", path });
    else if (!canonicalPath(path) || !Array.isArray(allowed) || !allowed.some((entry) =>
      typeof entry === "string" && (entry.endsWith("/") ? path.startsWith(entry) : path === entry)))
      failures.push({ reason: "changed_path_outside_goal", path });
  }
  for (const [path, lines] of addedLinesByPath) {
    if (!path.startsWith(IOS_DRIFT_SCAN_PREFIX) || /\/(?:Tests|UITests)\//.test(path)) continue;
    if (/\b(?:submitOrder|brokerLogin)\b/.test(lines)) failures.push({ reason: "forbidden_ios_trading_or_recommendation_semantics", path });
  }
  const evidence = goal.evidence ?? {};
  for (const lane of ["implementation", "integration", "runtime", "owner_acceptance"]) {
    const item = evidence[lane];
    if (!item || !["UNKNOWN", "PARTIAL", "PASS", "FAIL", "NOT_APPLICABLE"].includes(item.status)) {
      fail("evidence_status_invalid", lane); continue;
    }
    if (["PASS", "PARTIAL", "FAIL"].includes(item.status) &&
        (!validSha(item.head_sha) || !text(item.reference) || !text(item.scope))) fail("evidence_binding_missing", lane);
    if (item.status === "UNKNOWN" && (item.head_sha !== null || item.reference !== null)) fail("unknown_evidence_has_claim", lane);
    if (item.status === "NOT_APPLICABLE" && !text(item.reason)) fail("evidence_not_applicable_reason_missing", lane);
  }
  const review = goal.exact_head_review ?? {};
  if (!["pending", "blocked", "passed"].includes(review.status)) fail("exact_head_review_state_invalid", review.status);
  if (review.status === "pending" ? review.head_sha !== null : !validSha(review.head_sha)) fail("exact_head_reviewed_sha_invalid", review.head_sha);
  if (externalReviewedHeadSha !== null && !validSha(externalReviewedHeadSha)) fail("external_exact_head_reviewed_sha_invalid", externalReviewedHeadSha);
  const exactHeadPassed = validSha(currentHeadSha) && externalReviewedHeadSha === currentHeadSha && worktreeClean === true;
  if ((requireExactHeadReview || review.status === "passed" || goal.status === "completed") && !exactHeadPassed) fail("external_exact_head_review_required", externalReviewedHeadSha);
  if (review.status === "passed" && review.head_sha !== currentHeadSha) fail("review_head_mismatch", review.head_sha);
  if (goal.status === "completed") {
    for (const lane of ["implementation", "integration"])
      if (evidence[lane]?.status !== "PASS") fail("completion_core_evidence_required", lane);
    for (const lane of ["implementation", "integration", "runtime", "owner_acceptance"]) {
      const item = evidence[lane];
      if (!item || !["PASS", "NOT_APPLICABLE"].includes(item.status)) fail("completion_evidence_missing", lane);
      if (item?.status === "PASS" && item.head_sha !== goal.source_head_sha) fail("completion_evidence_version_mismatch", lane);
    }
  }
  return {
    authorityGranted: false, // Consistency checking never grants execution, publication or merge authority.
    verificationLevel: "legacy_structure", lifecycleEligible: false,
    goalId: goal.goal_id, goalStatus: goal.status, branch: goal.branch,
    baseMainSha: goal.base_main_sha, sourceHeadSha: goal.source_head_sha,
    nextTask: next.goal_id, nextTaskExecutable: ["in_progress", "review_ready"].includes(goal.status),
    exactHeadGate: { state: review.status, reviewedHeadSha: externalReviewedHeadSha, currentHeadSha, worktreeClean, passed: exactHeadPassed },
    changedPaths, ok: failures.length === 0,
    semanticAlignment: failures.length === 0 ? "aligned" : "drifted", failures,
  };
}

const SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
const taskStatuses = ["PREPARING_DISPATCH", "DISPATCHED", "IN_PROGRESS", "REVIEW_READY", "COMPLETED", "PAUSED", "BLOCKED", "CANCELLED", "DEPENDENCY_DIAGNOSIS"];
const controllerSourcePaths = ["AGENTS.md", "scripts/product-goal-check.mjs", "scripts/project-state-verify.mjs", "tests/unit/product-goal-check.test.mjs"];
const lifecycles = ["dispatch", "integrate", "closeout", "resume"];
const matchesPath = (path, entries) => entries.some((entry) => entry.endsWith("/") ? path.startsWith(entry) : path === entry);
const canonicalPath = (path) => nonempty(path) && !isAbsolute(path) && !path.includes("\\") && !path.includes("\0")
  && !path.split("/").some((part, index, parts) => part === "." || part === ".." || (part === "" && index !== parts.length - 1));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

// A controller record, including a broken one, is never an implicit legacy selection.
export function resolveEffectiveTask(state) {
  const controller = state?.project_controller_handoff;
  if (!controller) return { source: "legacy", task: state?.local_goal, controller: null, failures: [] };
  const failures = [];
  if (controller.status !== "ACTIVE") failures.push({ reason: "controller_not_active" });
  if (!controller.current_task || typeof controller.current_task !== "object") failures.push({ reason: "active_current_task_missing" });
  return { source: "controller", controller, task: controller.current_task ?? {}, failures };
}

// Repository-relative, bounded, no-follow reads. Evidence never opens .ai-bridge.
export function readBoundedRepositoryFile(root, path, maxBytes = 1_048_576) {
  if (!canonicalPath(path) || path.endsWith("/") || path.split("/").includes(".ai-bridge")) throw new Error("unsafe_reference_path");
  let candidate = realpathSync(root);
  for (const [index, part] of path.split("/").entries()) {
    candidate = join(candidate, part);
    const stat = lstatSync(candidate);
    if (stat.isSymbolicLink() || (index < path.split("/").length - 1 ? !stat.isDirectory() : !stat.isFile())) throw new Error("reference_not_regular_no_follow");
  }
  const descriptor = openSync(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size > maxBytes) throw new Error("reference_too_large_or_not_regular");
    const buffer = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = readSync(descriptor, buffer, size, buffer.length - size, null);
      if (!count) break;
      size += count;
    }
    const after = fstatSync(descriptor);
    if (size > maxBytes || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("reference_changed_during_read");
    return buffer.subarray(0, size);
  } finally { closeSync(descriptor); }
}

export function parseVerificationArguments(argv) {
  const options = { live: false, operation: "diagnose", claim: "task_scope" };
  const names = new Map([
    ["--state-root", "stateRoot"], ["--execution-root", "executionRoot"], ["--task-id", "taskId"],
    ["--task-revision", "taskRevision"], ["--caller-thread", "callerThread"], ["--lifecycle", "lifecycle"],
    ["--operation", "operation"], ["--target-head", "targetHead"], ["--claim", "claim"],
    ["--expected-state-sha256", "expectedStateSha256"], ["--expected-execution-head", "expectedExecutionHead"],
    ["--stage-input", "stageInput"],
  ]);
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (seen.has(arg)) throw new Error("duplicate_verification_argument");
    seen.add(arg);
    if (arg === "--live") { options.live = true; continue; }
    const key = names.get(arg), value = argv[++index];
    if (!key || !nonempty(value) || value.startsWith("--")) throw new Error("invalid_verification_argument");
    options[key] = value;
  }
  if (options.taskRevision !== undefined) {
    if (!/^[1-9][0-9]*$/.test(options.taskRevision) || !Number.isSafeInteger(Number(options.taskRevision))) throw new Error("invalid_task_revision_argument");
    options.taskRevision = Number(options.taskRevision);
  }
  if (!options.live && options.lifecycle) throw new Error("lifecycle_requires_live_context");
  if (options.live && (!lifecycles.includes(options.lifecycle) || !["stateRoot", "executionRoot", "taskId", "taskRevision", "callerThread"].every((key) => options[key]))) throw new Error("live_binding_arguments_required");
  if (!["diagnose", "repository_write", "runtime_mutation", "database_access", "paid_api_call", "physical_device"].includes(options.operation)) throw new Error("invalid_operation");
  if (!["task_scope", "product_acceptance"].includes(options.claim)) throw new Error("invalid_claim");
  return options;
}

function validEvidenceRequirement(requirement, task) {
  return requirement && task.criteria_ids?.includes(requirement.criterion_id) && nonempty(requirement.scope)
    && ["cli_execution", "independent_review", "runtime_observation", "owner_acceptance"].includes(requirement.kind)
    && Array.isArray(requirement.producer_thread_ids) && requirement.producer_thread_ids.length > 0
    && requirement.producer_thread_ids.every(nonempty) && new Set(requirement.producer_thread_ids).size === requirement.producer_thread_ids.length
    && (requirement.kind !== "cli_execution" || ["project_cli", "project_cli_snapshot", "node_test_suite"].includes(requirement.cli_format));
}

function matchesEvidenceRequirement(record, requirement) {
  return record?.criterion_id === requirement.criterion_id && record.scope === requirement.scope && record.kind === requirement.kind
    && requirement.producer_thread_ids.includes(record.producer_thread_id)
    && (record.kind !== "cli_execution" || (Array.isArray(record.checks) && record.checks.length > 0
      && record.checks.every((check) => (check.format ?? "project_cli") === requirement.cli_format)));
}

export function collectEvidenceBindings(task, { stateRoot, executionRoot, taskSpecSha256, managementPaths = [] }) {
  if (Array.isArray(task.evidence) && task.evidence.length > 32) return [{ reason: "evidence_count_limit_exceeded" }];
  let bytesRead = 0;
  const readEvidence = (root, reference, maxBytes) => {
    const bytes = readBoundedRepositoryFile(root, reference, maxBytes);
    bytesRead += bytes.length;
    if (bytesRead > 16 * 1_048_576) throw new Error("evidence_total_bytes_exceeded");
    return bytes;
  };
  return (Array.isArray(task.evidence) ? task.evidence : []).map((item) => {
    const result = { item, readable: false, applicable: false };
    if (["UNKNOWN", "NOT_APPLICABLE"].includes(item?.status)) return result;
    try {
      if (!item || !["PASS", "PARTIAL", "FAIL"].includes(item.status) || !["root", "execution"].includes(item.storage)) throw new Error("evidence_descriptor_invalid");
      const root = item.storage === "root" ? stateRoot : executionRoot;
      const bytes = readEvidence(root, item.reference);
      result.readable = true;
      result.sha256 = digest(bytes);
      if (!SHA256.test(item.sha256 ?? "") || item.sha256 !== result.sha256) throw new Error("evidence_digest_mismatch");
      const record = JSON.parse(decodeUtf8(bytes, "task evidence"));
      for (const key of ["object_id", "task_revision", "task_spec_sha256", "criterion_id", "head_sha", "scope", "kind", "status", "producer_thread_id"])
        if (record[key] !== item[key]) throw new Error("evidence_record_binding_mismatch");
      if (record.object_id !== task.task_id || record.task_revision !== task.revision || record.task_spec_sha256 !== taskSpecSha256
        || !task.criteria_ids?.includes(record.criterion_id) || !SHA.test(record.head_sha ?? "") || !nonempty(record.producer_thread_id)) throw new Error("evidence_task_or_version_invalid");
      if (!(Array.isArray(task.evidence_requirements) ? task.evidence_requirements : []).some((requirement) =>
        validEvidenceRequirement(requirement, task) && matchesEvidenceRequirement(record, requirement))) throw new Error("evidence_requirement_binding_mismatch");
      if (record.kind === "cli_execution") {
        if (!Array.isArray(record.checks) || !record.checks.length || record.checks.length > 64) throw new Error("cli_observation_missing");
        for (const check of record.checks) {
          if (!nonempty(check.command) || !Number.isInteger(check.exit_code) || (record.status === "PASS" && check.exit_code !== 0) || !Array.isArray(check.outputs) || !check.outputs.length || check.outputs.length > 32) throw new Error("cli_observation_invalid");
          for (const output of check.outputs) {
            const outputBytes = readEvidence(root, output.reference, 8 * 1_048_576);
            if (!SHA256.test(output.sha256 ?? "") || digest(outputBytes) !== output.sha256) throw new Error("cli_output_digest_mismatch");
            const format = check.format ?? "project_cli";
            if (["project_cli", "project_cli_snapshot"].includes(format)) {
              const raw = JSON.parse(decodeUtf8(outputBytes, "project CLI original"));
              if (typeof raw.ok !== "boolean" || !["snapshot_structure", "observed_lifecycle"].includes(raw.verificationLevel)) throw new Error("cli_output_format_unsupported");
              if (record.status === "PASS" && (raw.ok !== true || (format === "project_cli" ? raw.lifecycleEligible !== true || raw.verificationLevel !== "observed_lifecycle"
                : raw.lifecycleEligible !== false || raw.verificationLevel !== "snapshot_structure"))) throw new Error("cli_original_result_contradicts_pass");
              if (raw.effectiveTask?.task_id !== record.object_id || raw.effectiveTask?.revision !== record.task_revision
                || raw.observation?.taskSpecSha256 !== record.task_spec_sha256) throw new Error("cli_original_task_binding_mismatch");
              const observedHead = raw.observation?.executionHead;
              if (!SHA.test(observedHead ?? "")) throw new Error("cli_original_version_missing");
              if (observedHead !== record.head_sha) {
                const metadataPaths = [...managementPaths, ...(task.allowed_paths ?? []).filter((path) => path.startsWith("docs/"))];
                if (!gitIsAncestor(record.head_sha, observedHead, { cwd: executionRoot }) || !nulFields(gitBuffer(["diff", "--name-only", "--no-renames", "-z", record.head_sha, observedHead, "--"], { cwd: executionRoot }), "CLI source metadata delta")
                  .every((path) => matchesPath(path, metadataPaths))) throw new Error("cli_original_version_mismatch");
              }
            } else if (format === "node_test_suite") {
              // A suite proves its source/test result, not live success of each synthetic fixture.
              const text = decodeUtf8(outputBytes, "Node test suite original");
              const count = (name) => { const values = [...text.matchAll(new RegExp(`^(?:ℹ |# )${name} ([0-9]+)\\s*$`, "gm"))];
                if (values.length !== 1) throw new Error("node_test_summary_unsupported"); return Number(values[0][1]); };
              const tests = count("tests"), passed = count("pass"), failed = count("fail");
              if (tests < 1 || passed + failed > tests || (record.status === "PASS" && (failed !== 0 || passed < 1))) throw new Error("node_test_result_contradicts_pass");
              const source = check.source_manifest;
              if (!source || !SHA256.test(source.sha256 ?? "")) throw new Error("node_test_source_manifest_missing");
              const bytes = readEvidence(root, source.reference);
              if (digest(bytes) !== source.sha256) throw new Error("node_test_source_manifest_digest_mismatch");
              const manifest = JSON.parse(decodeUtf8(bytes, "Node test source manifest"));
              if (!manifest.results?.some((entry) => entry.command === check.command && entry.exitCode === check.exit_code && entry.log === output.reference)) throw new Error("node_test_command_source_mismatch");
              for (const path of controllerSourcePaths.filter((path) => path !== "AGENTS.md")) {
                if (!SHA256.test(manifest.sourceBefore?.[path] ?? "") || manifest.sourceBefore[path] !== manifest.sourceAfter?.[path]
                  || manifest.sourceBefore[path] !== digest(gitBuffer(["show", `${record.head_sha}:${path}`], { cwd: executionRoot, maxBuffer: 1_048_576 }))) throw new Error("node_test_source_version_mismatch");
              }
            } else throw new Error("cli_output_format_unsupported");
          }
        }
      } else if (record.kind === "independent_review") {
        if (record.producer_thread_id !== task.reviewer_thread_id || [task.execution?.thread_id, task.integrator_thread_id].includes(record.producer_thread_id)
          || record.review?.head_sha !== record.head_sha || record.review?.outcome !== record.status) throw new Error("independent_review_binding_invalid");
        const source = record.review.source;
        if (!source || !nonempty(source.turn_id) || !nonempty(source.message_id) || !SHA256.test(source.sha256 ?? "")
          || !canonicalPath(source.reference) || !source.reference.startsWith("docs/") || !matchesPath(source.reference, managementPaths)
          || matchesPath(source.reference, task.allowed_paths ?? [])) throw new Error("independent_review_source_missing_or_not_controller_owned");
        const rawBytes = readEvidence(stateRoot, source.reference);
        if (digest(rawBytes) !== source.sha256) throw new Error("independent_review_source_digest_mismatch");
        const raw = JSON.parse(decodeUtf8(rawBytes, "independent read_thread source"));
        let response = raw;
        if (Array.isArray(raw.content)) {
          const texts = raw.content.filter((entry) => entry.type === "text");
          if (raw.isError || texts.length !== 1) throw new Error("independent_review_source_format_invalid");
          response = JSON.parse(texts[0].text);
        }
        if (response.schemaVersion !== 1 || response.thread?.id !== task.reviewer_thread_id || response.thread?.kind !== "codex"
          || response.thread?.hostId !== task.execution?.host_id || !Array.isArray(response.turns)) throw new Error("independent_review_source_window_mismatch");
        const turn = response.turns.find((entry) => entry.id === source.turn_id);
        const message = turn?.items?.find((entry) => entry.id === source.message_id);
        if (turn?.status !== "completed" || turn.error || message?.type !== "agentMessage" || !["final_answer", "final"].includes(message.phase) || !nonempty(message.text)) throw new Error("independent_review_final_source_missing");
        let text = message.text.trim().replace(/\s*<oai-mem-citation>[\s\S]*<\/oai-mem-citation>\s*$/, "");
        const fenced = text.match(/^```json\s*\n([\s\S]*)\n```$/);
        if (fenced) text = fenced[1];
        const returned = JSON.parse(text);
        for (const key of ["object_id", "task_revision", "task_spec_sha256", "criterion_id", "head_sha", "scope", "kind", "status", "producer_thread_id"])
          if (returned[key] !== record[key]) throw new Error("independent_review_returned_binding_mismatch");
        if (returned.review?.head_sha !== record.head_sha || returned.review?.outcome !== record.status) throw new Error("independent_review_returned_conclusion_mismatch");
      } else if (record.kind === "runtime_observation") {
        throw new Error("runtime_observation_reader_unsupported");
      } else if (record.kind === "owner_acceptance") {
        throw new Error("owner_acceptance_reader_unsupported");
      } else throw new Error("unsupported_current_evidence_kind");
      result.record = record;
      result.applicable = true;
    } catch (error) { result.reason = error.message; }
    return result;
  });
}

export async function loadVerificationContext(options = {}) {
  const stateRoot = realpathSync(options.stateRoot ?? process.cwd());
  const executionRoot = realpathSync(options.executionRoot ?? process.cwd());
  const projectState = decodeUtf8(readBoundedRepositoryFile(stateRoot, "PROJECT_STATE.yaml", 4 * 1_048_576), "project state");
  const state = JSON.parse(projectState), selection = resolveEffectiveTask(state);
  const context = { live: options.live === true, stateRoot, executionRoot, stateSha256: digest(projectState), failures: [], selection };
  const observe = (reason, action) => { try { return action(); } catch (error) { context.failures.push({ reason, message: error.message }); return null; } };
  context.rootHead = observe("root_git_unverified", () => readCurrentHeadSha({ cwd: stateRoot }));
  context.executionHead = observe("execution_git_unverified", () => readCurrentHeadSha({ cwd: executionRoot }));
  context.rootBranch = observe("root_branch_unverified", () => gitText(["branch", "--show-current"], { cwd: stateRoot }).trim());
  context.executionBranch = observe("execution_branch_unverified", () => gitText(["branch", "--show-current"], { cwd: executionRoot }).trim());
  const common = (cwd) => realpathSync(resolve(cwd, gitText(["rev-parse", "--git-common-dir"], { cwd }).trim()));
  context.sameRepository = observe("git_common_directory_unverified", () => common(stateRoot) === common(executionRoot));
  const task = selection.task ?? {};
  const base = selection.source === "controller" ? task.execution?.base_head : task.source_head_sha;
  const changes = observe("changed_scope_unverified", () => {
    if (!SHA.test(base ?? "")) throw new Error("invalid comparison base");
    return collectChangedPaths({ base, cwd: executionRoot });
  });
  context.changedPaths = changes?.changedPaths ?? [];
  context.dirtyPaths = observe("dirty_scope_unverified", () => collectChangedPaths({ base: "HEAD", cwd: executionRoot }).changedPaths) ?? [];
  context.addedLinesByPath = changes ? observe("ios_added_lines_unverified", () => collectIosAddedLines({ ...changes, base, cwd: executionRoot })) ?? new Map() : new Map();
  context.worktreeClean = observe("worktree_clean_unverified", () => readWorktreeClean({ cwd: executionRoot }));
  context.sourceIsAncestor = observe("source_ancestry_unverified", () => SHA.test(base ?? "") && gitIsAncestor(base, context.executionHead, { cwd: executionRoot }));
  if (selection.source === "legacy") context.baseMainIsAncestor = observe("base_main_ancestry_unverified", () => SHA.test(task.base_main_sha ?? "") && gitIsAncestor(task.base_main_sha, context.executionHead, { cwd: executionRoot }));
  context.dirtyDigest = observe("dirty_diff_unverified", () => {
    const entries = [...(changes?.untrackedPaths ?? [])], allowed = selection.source === "controller"
      ? [...(task.allowed_paths ?? []), ...(selection.controller.management_paths ?? [])] : task.allowed_paths ?? [];
    if (entries.length > 128) throw new Error("untracked_content_count_exceeded");
    let total = 0;
    const contents = entries.filter((path) => canonicalPath(path) && !path.split("/").includes(".ai-bridge") && matchesPath(path, allowed)).map((path) => {
      const bytes = readBoundedRepositoryFile(executionRoot, path, 8 * 1_048_576);
      total += bytes.length;
      if (total > 16 * 1_048_576) throw new Error("untracked_content_bytes_exceeded");
      return { path, sha256: digest(bytes) };
    });
    return digest(Buffer.concat([gitBuffer(["diff", "--no-ext-diff", "--binary", "HEAD", "--"], { cwd: executionRoot }), Buffer.from(JSON.stringify(contents))]));
  });
  if (selection.source === "controller") {
    context.references = {};
    for (const key of ["task_brief", "authority"]) context.references[key] = observe("task_reference_unverified", () => digest(readBoundedRepositoryFile(stateRoot, task[key])));
    context.references.agents = observe("task_rules_unverified", () => digest(readBoundedRepositoryFile(executionRoot, "AGENTS.md")));
    context.taskSpecSha256 = digest(JSON.stringify({ task_id: task.task_id, revision: task.revision, mode: task.mode, scope: task.scope,
      limits: task.limits, allowed_paths: task.allowed_paths, execution: task.execution, criteria_ids: task.criteria_ids,
      evidence_requirements: task.evidence_requirements, integrator_thread_id: task.integrator_thread_id, reviewer_thread_id: task.reviewer_thread_id,
      stage_id: task.stage_id, stage_issue: task.stage_issue, stage_expected_main_sha: task.stage_expected_main_sha,
      business_code_checkpoint: task.business_code_checkpoint, references: context.references }));
    context.businessBasePaths = observe("business_checkpoint_unverified", () => {
      if (!SHA.test(task.business_code_checkpoint ?? "") || !gitIsAncestor(task.business_code_checkpoint, base, { cwd: executionRoot })) throw new Error("business_checkpoint_not_base_ancestor");
      return nulFields(gitBuffer(["diff", "--no-renames", "--name-only", "-z", task.business_code_checkpoint, base, "--"], { cwd: executionRoot }), "business checkpoint diff");
    });
    context.evidence = collectEvidenceBindings(task, { ...context, managementPaths: selection.controller.management_paths });
    const compatibleHead = (head) => {
      if (!SHA.test(head ?? "") || !gitIsAncestor(head, context.executionHead, { cwd: executionRoot })) return false;
      const metadataPaths = [...(selection.controller.management_paths ?? []), ...(task.allowed_paths ?? []).filter((path) => path.startsWith("docs/"))];
      return nulFields(gitBuffer(["diff", "--no-renames", "--name-only", "-z", head, context.executionHead, "--"], { cwd: executionRoot }), "candidate metadata delta").every((path) => matchesPath(path, metadataPaths));
    };
    if (options.targetHead && SHA.test(options.targetHead)) context.targetCompatible = observe("candidate_version_unverified", () => compatibleHead(options.targetHead));
    const execution = task.execution ?? {};
    if (stateRoot === executionRoot && execution.topology === "serialized_shared_checkout" && nonempty(execution.original_branch)) {
      context.serialRefs = observe("serial_reference_unverified", () => ({
        candidateHead: gitText(["rev-parse", "--verify", `refs/heads/${execution.branch}`], { cwd: executionRoot }).trim(),
        originalHead: gitText(["rev-parse", "--verify", `refs/heads/${execution.original_branch}`], { cwd: executionRoot }).trim(),
        originalBaseIsAncestor: SHA.test(execution.original_ref_oid ?? "") && gitIsAncestor(execution.original_ref_oid, context.executionHead, { cwd: executionRoot }),
      }));
      if (task.integration?.status === "INTEGRATED") context.integratedBinding = observe("integrated_version_unverified", () =>
        context.serialRefs?.candidateHead === task.integration.installed_head && context.serialRefs?.originalHead === context.executionHead
        && context.serialRefs?.originalBaseIsAncestor === true && compatibleHead(task.integration.installed_head) && compatibleHead(task.integration.source_head));
    }
  }
  if (context.live) {
    context.lock = await readStageRunLockStatus({ lockRoot: selection.controller?.controller_lock?.lockRoot });
    const metadata = context.lock.metadata;
    context.lockAlive = false;
    if (metadata?.hostname === hostname() && Number.isSafeInteger(metadata.pid) && metadata.pid > 0) {
      try {
        process.kill(metadata.pid, 0);
        context.lockAlive = Number(execFileSync("ps", ["-p", String(metadata.pid), "-o", "ppid="], { encoding: "utf8", timeout: 5000 }).trim()) === metadata.ppid;
      } catch { /* Missing/lost controller is a refusal, never lock recovery. */ }
    }
    if (task.mode === "stage_runner") {
      try {
        const input = JSON.parse(decodeUtf8(readBoundedRepositoryFile(stateRoot, options.stageInput), "Stage input"));
        if (!input.issue || !Array.isArray(input.comments) || !SHA.test(task.stage_expected_main_sha ?? "") || !Number.isSafeInteger(task.stage_issue)) throw new Error("stage_input_incomplete");
        const { extractEnvelope, parseEnvelopeContent } = await import("./lib/codex-stage.mjs");
        const match = extractEnvelope(input.issue.body ?? ""), envelope = parseEnvelopeContent(match.language, match.content);
        if (envelope.expected_pr_number !== undefined && !input.pullRequest) throw new Error("stage_pull_request_input_missing");
        const { validateStageIssue } = await import("./codex-stage-task-validate.mjs");
        const normalized = await validateStageIssue({ issueNumber: task.stage_issue, repositoryFullName: state.repository, localRepositoryPath: executionRoot,
          issue: input.issue, comments: input.comments, currentMainSha: task.stage_expected_main_sha,
          schema: JSON.parse(decodeUtf8(readBoundedRepositoryFile(stateRoot, ".github/codex/schemas/stage-task.schema.json"), "Stage schema")),
          worktreeStatus: context.worktreeClean ? "" : "dirty", pullRequest: input.pullRequest,
          ghCommentsImpl: async () => { throw new Error("stage_network_not_available_in_checker"); } });
        context.stageEnvelopeValidated = normalized.branch === task.execution?.branch && normalized.stage_id === task.stage_id && normalized.issue.number === task.stage_issue
          && JSON.stringify([...normalized.allowed_paths].sort()) === JSON.stringify([...task.allowed_paths].sort());
      } catch (error) { context.failures.push({ reason: "stage_envelope_validation_required", message: error.message }); }
    }
  }
  if (digest(readBoundedRepositoryFile(stateRoot, "PROJECT_STATE.yaml", 4 * 1_048_576)) !== context.stateSha256
    || readCurrentHeadSha({ cwd: stateRoot }) !== context.rootHead || readCurrentHeadSha({ cwd: executionRoot }) !== context.executionHead) context.failures.push({ reason: "verification_context_changed_during_read" });
  return { projectState, state, context };
}

function evaluateControllerTaskState({ state, changedPaths, addedLinesByPath, context, invocation }) {
  const { controller, task, failures } = resolveEffectiveTask(state);
  const fail = (reason, actual) => failures.push({ reason, ...(actual === undefined ? {} : { actual }) });
  if (state.schema_version !== 2 || state.project !== "investment-assistant-system" || state.repository !== "guijixingqiu/investment-assistant-system") fail("project_identity_or_schema_invalid");
  if (!["active", "paused", "completed"].includes(state.status)) fail("project_status_invalid");
  if (state.history?.executable !== false) fail("history_must_be_non_executable");
  if (state.local_goal?.advisory_only !== true || state.local_goal?.production_status !== "NO_GO") fail("unsafe_product_boundary");
  for (const key of ["task_id", "scope", "task_brief", "authority", "completion"]) if (!nonempty(task[key])) fail("current_task_field_missing", key);
  if (!Number.isSafeInteger(task.revision) || task.revision < 1) fail("current_task_revision_invalid");
  if (!["owner_authorized_local", "owner_authorized_goal_pursuit", "stage_runner"].includes(task.mode)) fail("current_task_mode_invalid");
  if (!taskStatuses.includes(task.status)) fail("current_task_status_invalid");
  for (const key of ["base_head", "business_code_checkpoint"]) if (!SHA.test(task[key] ?? "")) fail("current_task_sha_invalid", key);
  if (!nonempty(controller?.controller_thread_id) || !isAbsolute(controller?.control_root_worktree ?? "") || !nonempty(controller?.control_branch)) fail("controller_binding_missing");
  const execution = task.execution ?? {};
  if (!isAbsolute(execution.worktree ?? "") || !nonempty(execution.branch) || !SHA.test(execution.base_head ?? "")) fail("execution_binding_missing");
  if (task.status !== "PREPARING_DISPATCH" && (!nonempty(execution.thread_id) || !nonempty(execution.host_id))) fail("execution_window_missing");
  for (const key of ["thread_id", "host_id"]) if (task[key] !== undefined && task[key] !== execution[key]) fail("execution_window_conflict", key);
  if (!Array.isArray(task.criteria_ids) || !task.criteria_ids.length || !task.criteria_ids.every(nonempty) || new Set(task.criteria_ids).size !== task.criteria_ids.length) fail("task_criteria_invalid");
  const allowed = Array.isArray(task.allowed_paths) ? task.allowed_paths : [];
  const management = Array.isArray(controller?.management_paths) ? controller.management_paths : [];
  if (!Array.isArray(task.allowed_paths) || !allowed.every(canonicalPath) || (task.limits?.repository_writes && !allowed.length)) fail("allowed_paths_invalid");
  if (!management.every(canonicalPath) || management.some((path) => path !== "PROJECT_STATE.yaml" && !path.startsWith("docs/"))) fail("management_paths_invalid");
  for (const key of ["repository_writes", "runtime_mutations", "database_access", "physical_device_operations"]) if (typeof task.limits?.[key] !== "boolean") fail("task_limit_invalid", key);
  if (!Number.isSafeInteger(task.limits?.paid_api_calls) || task.limits.paid_api_calls < 0) fail("task_limit_invalid", "paid_api_calls");
  for (const path of changedPaths) {
    if (path.split("/").includes(".ai-bridge")) failures.push({ reason: "ai_bridge_path_forbidden", path });
    else if (!canonicalPath(path) || !matchesPath(path, [...allowed, ...management])) failures.push({ reason: "changed_path_outside_goal", path });
  }
  for (const [path, lines] of addedLinesByPath) if (path.startsWith(IOS_DRIFT_SCAN_PREFIX) && !/\/(?:Tests|UITests)\//.test(path)
    && /\b(?:submitOrder|brokerLogin)\b/.test(lines)) failures.push({ reason: "forbidden_ios_trading_or_recommendation_semantics", path });
  if (context) failures.push(...context.failures);
  if (task.status === "COMPLETED" && !context?.live) fail("completion_requires_observed_lifecycle_check");
  const live = context?.live === true;
  if (live) {
    if (context.selection.source !== "controller" || !context.sameRepository) fail("root_execution_repository_mismatch");
    try {
      if (realpathSync(controller.control_root_worktree) !== context.stateRoot || realpathSync(execution.worktree) !== context.executionRoot) fail("root_execution_path_mismatch");
    } catch { fail("root_execution_path_unverified"); }
    const reviewedTarget = context.evidence?.some((entry) => entry.applicable && entry.record?.kind === "independent_review" && entry.record.status === "PASS" && entry.record.head_sha === invocation.targetHead);
    const pendingRestoreSync = invocation.lifecycle === "resume" && invocation.operation === "repository_write" && invocation.callerThread === controller.controller_thread_id
      && context.stateRoot === context.executionRoot && execution.topology === "serialized_shared_checkout" && context.worktreeClean === true
      && controller.control_branch === execution.branch && context.rootBranch === execution.original_branch && context.executionBranch === execution.original_branch
      && context.serialRefs?.originalHead === context.executionHead && context.serialRefs?.candidateHead === context.executionHead
      && context.serialRefs?.originalBaseIsAncestor === true && context.targetCompatible === true && reviewedTarget && task.integration?.status !== "INTEGRATED";
    const integrated = task.integration?.status === "INTEGRATED" && context.stateRoot === context.executionRoot && execution.topology === "serialized_shared_checkout";
    const expectedExecutionBranch = integrated ? execution.original_branch : execution.branch;
    if (!pendingRestoreSync && (context.rootBranch !== controller.control_branch || context.executionBranch !== expectedExecutionBranch)) fail("root_execution_branch_mismatch");
    if (integrated && context.integratedBinding !== true) fail("integrated_reference_binding_invalid");
    if (integrated && invocation.lifecycle === "integrate") fail("task_already_integrated");
    if (!integrated && invocation.lifecycle === "integrate" && execution.topology === "serialized_shared_checkout"
      && (!SHA.test(execution.original_ref_oid ?? "") || context.serialRefs?.originalHead !== execution.original_ref_oid)) fail("original_delivery_ref_drift");
    if (integrated && invocation.operation === "repository_write" && invocation.callerThread !== controller.controller_thread_id) fail("integrated_task_requires_controller_reassignment");
    context.managementSyncOnly = pendingRestoreSync;
    if (context.stateRoot === context.executionRoot && execution.topology !== "serialized_shared_checkout") fail("shared_checkout_not_registered");
    if (!context.sourceIsAncestor) fail("execution_base_not_ancestor");
    if (context.businessBasePaths?.some((path) => !matchesPath(path, [...management, ...controllerSourcePaths]) && !path.startsWith("docs/"))) fail("business_checkpoint_drift_before_task_base");
    if (invocation.taskId !== task.task_id || invocation.taskRevision !== task.revision) fail("task_binding_mismatch");
    if (invocation.expectedStateSha256 !== undefined && invocation.expectedStateSha256 !== context.stateSha256) fail("state_snapshot_changed");
    if (invocation.expectedExecutionHead !== undefined && invocation.expectedExecutionHead !== context.executionHead) fail("execution_head_changed");
    if (!lifecycles.includes(invocation.lifecycle)) fail("lifecycle_invalid");
    const callers = invocation.lifecycle === "dispatch" || invocation.lifecycle === "closeout" ? [controller.controller_thread_id]
      : invocation.lifecycle === "integrate" ? [task.integrator_thread_id] : [controller.controller_thread_id, execution.thread_id, task.reviewer_thread_id];
    if (!nonempty(invocation.callerThread) || !callers.includes(invocation.callerThread)) fail("caller_window_mismatch");
    const lock = context.lock, expected = controller.controller_lock;
    if (!expected || !lock?.locked || lock.incomplete || !context.lockAlive || lock.metadata?.hostname !== hostname()
      || !["pid", "ppid", "hostname", "acquiredAt"].every((key) => lock.metadata?.[key] === expected[key])) fail("controller_lock_unverified");
    try { if (realpathSync(lock?.metadata?.cwd) !== context.stateRoot) fail("controller_lock_root_mismatch"); } catch { fail("controller_lock_root_mismatch"); }
    if (state.status !== "active" || !["PREPARING_DISPATCH", "DISPATCHED", "IN_PROGRESS", "REVIEW_READY", "COMPLETED"].includes(task.status)
      || (task.status === "COMPLETED" && invocation.lifecycle !== "closeout")) fail("task_not_executable");
    if (task.status === "PREPARING_DISPATCH" && invocation.lifecycle !== "dispatch") fail("task_not_dispatched");
    if (task.mode === "stage_runner" && context.stageEnvelopeValidated !== true) fail("stage_envelope_validation_required");
    const permission = { repository_write: "repository_writes", runtime_mutation: "runtime_mutations", database_access: "database_access", physical_device: "physical_device_operations" }[invocation.operation];
    if (permission && task.limits?.[permission] !== true) fail("operation_outside_task_limits");
    if (invocation.operation === "paid_api_call") fail(task.limits?.paid_api_calls === 0 ? "paid_calls_forbidden_for_task" : "paid_resume_requires_separate_existing_preflight");
    if (invocation.operation === "repository_write" && invocation.callerThread === task.reviewer_thread_id) fail("reviewer_cannot_implement");
    if (invocation.lifecycle === "integrate" && task.limits?.repository_writes !== true) fail("integration_outside_task_limits");
    for (const path of context.dirtyPaths ?? []) if (!matchesPath(path, invocation.callerThread === controller.controller_thread_id ? management : allowed)) failures.push({ reason: "dirty_path_outside_caller_scope", path });
    for (const observed of context.evidence ?? []) if (observed.reason) fail("current_evidence_unverified", { criterion: observed.item?.criterion_id, reason: observed.reason });
    if (["integrate", "closeout"].includes(invocation.lifecycle)) {
      if (!context.worktreeClean) fail("lifecycle_requires_clean_candidate");
      if (!SHA.test(invocation.targetHead ?? "") || context.targetCompatible !== true) fail("lifecycle_target_head_mismatch");
      const requirements = task.evidence_requirements;
      if (!Array.isArray(requirements) || !requirements.length) fail("evidence_requirements_missing");
      else {
        const applicable = requirements.filter((entry) => Array.isArray(entry.lifecycle) && entry.lifecycle.includes(invocation.lifecycle));
        const deferPersonalReview = invocation.lifecycle === "integrate" && task.mode === "owner_authorized_local"
          && applicable.length === 0 && Array.isArray(task.criteria_ids) && task.criteria_ids.length > 0
          && task.criteria_ids.every((id) => requirements.some((entry) => entry.criterion_id === id
            && entry.kind === "independent_review" && Array.isArray(entry.lifecycle)
            && entry.lifecycle.includes("closeout") && validEvidenceRequirement(entry, task)));
        if ((!applicable.length && !deferPersonalReview)
          || (invocation.lifecycle === "closeout" && !task.criteria_ids.every((id) => applicable.some((entry) => entry.criterion_id === id)))) fail("completion_criteria_not_covered");
        for (const requirement of applicable) {
          if (!validEvidenceRequirement(requirement, task)) { fail("evidence_requirement_invalid"); continue; }
          const proof = context.evidence?.find((entry) => entry.applicable && matchesEvidenceRequirement(entry.record, requirement)
            && entry.record?.head_sha === invocation.targetHead && entry.record?.status === "PASS");
          if (!proof) fail("required_current_evidence_missing", requirement.criterion_id);
        }
        if (!deferPersonalReview && !applicable.some((entry) => entry.kind === "independent_review")) fail("independent_review_requirement_missing");
      }
      if (invocation.claim === "product_acceptance" && !context.evidence?.some((entry) => entry.applicable && entry.record?.kind === "owner_acceptance" && entry.record.status === "PASS" && entry.record.head_sha === invocation.targetHead)) fail("owner_product_acceptance_unknown");
    }
  }
  return { ok: failures.length === 0, authorityGranted: false, verificationLevel: live ? "observed_lifecycle" : "snapshot_structure",
    lifecycleEligible: live && failures.length === 0, effectiveTaskSource: "controller", effectiveTask: { task_id: task.task_id, revision: task.revision, mode: task.mode, status: task.status },
    nextTaskExecutable: false, changedPaths, semanticAlignment: failures.length ? "drifted" : "aligned", failures,
    managementSyncOnly: context?.managementSyncOnly === true,
    observation: context ? { rootHead: context.rootHead, executionHead: context.executionHead, stateSha256: context.stateSha256, taskSpecSha256: context.taskSpecSha256,
      briefSha256: context.references?.task_brief, dirtyDigest: context.dirtyDigest, worktreeClean: context.worktreeClean,
      evidence: context.evidence?.map(({ item, readable, applicable, sha256, reason }) => ({ criterion_id: item?.criterion_id,
        claimedStatus: item?.status, status: applicable ? item.status : "UNKNOWN", readable, applicable, sha256, reason })) } : null };
}

export async function verifySelectedTask(options = {}) {
  // Capture primitive invocation options; caller state/context/diffs are not accepted.
  const flags = new Map([["stateRoot", "--state-root"], ["executionRoot", "--execution-root"], ["taskId", "--task-id"], ["taskRevision", "--task-revision"],
    ["callerThread", "--caller-thread"], ["lifecycle", "--lifecycle"], ["operation", "--operation"], ["targetHead", "--target-head"], ["claim", "--claim"],
    ["expectedStateSha256", "--expected-state-sha256"], ["expectedExecutionHead", "--expected-execution-head"], ["stageInput", "--stage-input"]]);
  const args = options.live === true ? ["--live"] : [];
  for (const [key, flag] of flags) if (options[key] !== undefined) args.push(flag, String(options[key]));
  options = Object.freeze(parseVerificationArguments(args));
  const loaded = await loadVerificationContext(options);
  const { context, state, projectState } = loaded;
  const result = context.selection.source === "controller"
    ? evaluateControllerTaskState({ state, context, invocation: options, changedPaths: context.changedPaths, addedLinesByPath: context.addedLinesByPath })
    : evaluateProductRecoveryRebaselineState({ projectState, changedPaths: context.changedPaths,
    addedLinesByPath: context.addedLinesByPath, currentHeadSha: context.executionHead, currentBranch: context.executionBranch,
    externalReviewedHeadSha: process.env.CODEX_EXACT_REVIEWED_HEAD_SHA ?? null,
    requireExactHeadReview: process.env.CODEX_REQUIRE_EXACT_HEAD_REVIEW === "1", worktreeClean: context.worktreeClean });
  if (context.selection.source === "legacy") {
    result.failures.push(...context.failures);
    if (!context.sourceIsAncestor) result.failures.push({ reason: "package_source_not_ancestor" });
    if (!context.baseMainIsAncestor) result.failures.push({ reason: "checkpoint_not_current_ancestor", key: "base_main_sha" });
    if (context.live) result.failures.push({ reason: "live_controller_registration_required" });
    result.ok = result.failures.length === 0;
  }
  return { ...loaded, result };
}
export function collectChangedPaths({ base, cwd = process.cwd(), readGitBuffer = (args) => gitBuffer(args, { cwd }) }) {
  const pathKinds = new Map();
  const recordPath = (path, kind) => {
    if (!path) throw new Error("Git reported an empty changed path.");
    pathKinds.set(path, kind);
  };

  for (const path of nulFields(readGitBuffer(["diff", "--name-only", "--no-renames", "-z", base ?? "HEAD", "--"]), "git diff")) {
    recordPath(path, "tracked");
  }

  const statusFields = nulFields(
    readGitBuffer(["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    "git status"
  );
  for (let index = 0; index < statusFields.length; index += 1) {
    const entry = statusFields[index];
    if (entry.length < 4 || entry[2] !== " ") throw new Error("Git reported a malformed porcelain status record.");
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    if (status === "!!") continue;
    if (status === "??") {
      recordPath(path, "untracked");
      continue;
    }
    if (!/^[ MADRCUT]{2}$/.test(status) || status === "  ") {
      throw new Error(`Git reported an unsupported porcelain status ${JSON.stringify(status)}.`);
    }
    recordPath(path, "tracked");
    if (/[RC]/.test(status)) {
      const originalPath = statusFields[index + 1];
      if (!originalPath) throw new Error("Git rename or copy status omitted its original path.");
      recordPath(originalPath, "tracked");
      index += 1;
    }
  }

  return {
    changedPaths: [...pathKinds.keys()],
    untrackedPaths: new Set([...pathKinds].filter(([, kind]) => kind === "untracked").map(([path]) => path))
  };
}

export function readCurrentHeadSha({ cwd = process.cwd(), readGitBuffer = (args) => gitBuffer(args, { cwd }) } = {}) {
  const value = decodeUtf8(readGitBuffer(["rev-parse", "HEAD"]), "current Git HEAD").trim();
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error("Current Git HEAD is not a full SHA-1.");
  return value;
}

export function readWorktreeClean({ cwd = process.cwd(), readGitBuffer = (args) => gitBuffer(args, { cwd }) } = {}) {
  return readGitBuffer(["status", "--porcelain=v1", "--untracked-files=all"]).length === 0;
}

export function collectIosAddedLines({
  changedPaths,
  untrackedPaths = new Set(),
  base,
  cwd = process.cwd(),
  readGitText = (args) => gitText(args, { cwd }),
  readUntrackedText = (path) => readUntrackedIosText(path, { repoRoot: cwd })
}) {
  const addedLinesByPath = new Map();
  for (const path of changedPaths.filter((candidate) => candidate.startsWith(IOS_DRIFT_SCAN_PREFIX))) {
    if (untrackedPaths.has(path)) {
      addedLinesByPath.set(path, readUntrackedText(path));
      continue;
    }
    const pathspec = `:(top,literal)${path}`;
    const added = readGitText(["diff", "--no-ext-diff", "--no-renames", "--unified=0", base ?? "HEAD", "--", pathspec])
      .split("\n")
      .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
      .map((line) => line.slice(1))
      .join("\n");
    addedLinesByPath.set(path, added);
  }
  return addedLinesByPath;
}

export function collectStage19EvidenceBindings({
  changedPaths,
  cwd = process.cwd(),
  readGitBuffer = (args) => gitBuffer(args, { cwd, maxBuffer: STAGE19_BUNDLE_FILE_MAX_BYTES + 1 }),
  isAncestor = (sourceCommitSha) => gitIsAncestor(sourceCommitSha, "HEAD", { cwd }),
  validateSourceBundle = validateRealDataQuantSourceBundle
}) {
  const sourceSectionPattern = new RegExp(
    `^${escapeRegExp(STAGE19_FINAL_SOURCE_ROOT)}source-([0-9a-f]{12})/source-section\\.json$`
  );
  const legacySourceSection = `${STAGE19_FINAL_SOURCE_ROOT}source-4addb6995f87/source-section.json`;
  const bindings = new Map();
  for (const path of changedPaths) {
    const match = path.match(sourceSectionPattern);
    if (!match || path === legacySourceSection) continue;
    const bytes = readGitBuffer(["show", `HEAD:${path}`]);
    if (!Buffer.isBuffer(bytes) || bytes.length > STAGE19_SOURCE_SECTION_MAX_BYTES) {
      throw new Error(`Stage 19 source section exceeds ${STAGE19_SOURCE_SECTION_MAX_BYTES} bytes: ${JSON.stringify(path)}`);
    }
    let sourceSection;
    try {
      sourceSection = JSON.parse(decodeUtf8(bytes, `Stage 19 source section ${JSON.stringify(path)}`));
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(`Stage 19 source section is not valid JSON: ${JSON.stringify(path)}`);
      throw error;
    }
    const sourceCommitSha = sourceSection?.commitSha;
    const directory = path.slice(0, -"source-section.json".length);
    const sourceCommitIsAncestor = /^[0-9a-f]{40}$/.test(sourceCommitSha ?? "")
      && isAncestor(sourceCommitSha) === true;
    bindings.set(directory, {
      sourceCommitSha,
      sourceSectionPath: path,
      sourceCommitIsAncestor,
      strictBundleVerified: sourceCommitIsAncestor && strictStage19SourceBundleVerified({
        directory,
        sourceCommitSha,
        sourceSectionBytes: bytes,
        readGitBuffer,
        validateSourceBundle
      })
    });
  }
  return bindings;
}

function strictStage19SourceBundleVerified({
  directory,
  sourceCommitSha,
  sourceSectionBytes,
  readGitBuffer,
  validateSourceBundle
}) {
  try {
    const sourceSectionPath = `${directory}${REAL_DATA_QUANT_FILES.sourceSection}`;
    const bytesByPath = new Map([[sourceSectionPath, sourceSectionBytes]]);
    const bundleEntries = Object.entries(REAL_DATA_QUANT_FILES).slice(0, 5);
    const values = {};
    const files = bundleEntries.map(([key, name]) => {
      const path = `${directory}${name}`;
      const bytes = bytesByPath.get(path) ?? readGitBuffer(["show", `HEAD:${path}`]);
      if (!Buffer.isBuffer(bytes) || bytes.length > STAGE19_BUNDLE_FILE_MAX_BYTES) {
        throw new Error(`Stage 19 bundle file exceeds ${STAGE19_BUNDLE_FILE_MAX_BYTES} bytes: ${JSON.stringify(path)}`);
      }
      const value = JSON.parse(decodeUtf8(bytes, `Stage 19 bundle file ${JSON.stringify(path)}`));
      values[key] = value;
      return {
        path,
        value,
        bytes,
        artifact: { path, sha256: sha256(bytes) }
      };
    });
    return validateSourceBundle({
      files,
      sourceSection: values.sourceSection,
      proof: values.proof,
      historicalSource: values.historicalSource,
      snapshot: values.snapshot,
      runWitness: values.runWitness,
      sourceCommitSha,
      sourceFileBytes: (path) => readGitBuffer(["show", `${sourceCommitSha}:${path}`])
    }) === true;
  } catch {
    return false;
  }
}

export function readUntrackedIosText(path, { repoRoot = process.cwd(), maxBytes = IOS_UNTRACKED_SCAN_MAX_BYTES } = {}) {
  if (!path.startsWith(IOS_DRIFT_SCAN_PREFIX)) throw new Error(`Refusing to read non-iOS untracked path ${JSON.stringify(path)}.`);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("Untracked iOS scan byte limit is invalid.");
  const parts = safeRelativeParts(path);
  const root = realpathSync(repoRoot);
  let candidate = root;
  for (const [index, part] of parts.entries()) {
    candidate = join(candidate, part);
    const stats = lstatSync(candidate);
    if (stats.isSymbolicLink()) throw new Error(`Refusing to follow symlink while scanning ${JSON.stringify(path)}.`);
    if (index < parts.length - 1 && !stats.isDirectory()) {
      throw new Error(`Untracked iOS scan parent is not a directory for ${JSON.stringify(path)}.`);
    }
    if (index === parts.length - 1 && !stats.isFile()) {
      throw new Error(`Untracked iOS scan target is not a regular file: ${JSON.stringify(path)}.`);
    }
  }
  const fromRoot = relative(root, candidate);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`Untracked iOS scan path escaped the repository: ${JSON.stringify(path)}.`);
  }
  if (typeof constants.O_NOFOLLOW !== "number") throw new Error("This platform cannot enforce no-follow iOS scanning.");

  let descriptor;
  try {
    descriptor = openSync(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stats = fstatSync(descriptor);
    if (!stats.isFile()) throw new Error(`Opened iOS scan target is not a regular file: ${JSON.stringify(path)}.`);
    if (stats.size > maxBytes) throw new Error(`Untracked iOS scan target exceeds ${maxBytes} bytes: ${JSON.stringify(path)}.`);
    const bytes = Buffer.allocUnsafe(maxBytes + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    if (offset > maxBytes) throw new Error(`Untracked iOS scan target grew beyond ${maxBytes} bytes: ${JSON.stringify(path)}.`);
    return decodeUtf8(bytes.subarray(0, offset), `untracked iOS file ${JSON.stringify(path)}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

async function run() {
  try {
    const { result } = await verifySelectedTask(parseVerificationArguments(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ ok: false, authorityGranted: false, lifecycleEligible: false, failures: [{ reason: "verification_context_unavailable", message: error.message }] }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await run();

function gitBuffer(args, { cwd = process.cwd(), maxBuffer = GIT_OUTPUT_MAX_BYTES } = {}) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "buffer",
      env: gitReadonlyEnvironment(cwd),
      maxBuffer,
      timeout: 10000
    });
  } catch (error) {
    if (error.status === 1 && args[0] === "diff") return error.stdout ?? Buffer.alloc(0);
    throw error;
  }
}

function gitText(args, options) {
  return decodeUtf8(gitBuffer(args, options), `git ${args[0]} output`);
}

function gitIsAncestor(sourceCommitSha, targetCommitSha, { cwd = process.cwd() } = {}) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", sourceCommitSha, targetCommitSha], {
      cwd,
      env: gitReadonlyEnvironment(cwd),
      timeout: 10000,
      stdio: "ignore"
    });
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}

function gitReadonlyEnvironment(cwd) {
  return {
    PATH: "/usr/bin:/bin",
    LC_ALL: "C",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0"
  };
}

function nulFields(value, label) {
  const text = decodeUtf8(value, label);
  if (text === "") return [];
  if (!text.endsWith("\0")) throw new Error(`${label} did not return a complete NUL-delimited result.`);
  return text.slice(0, -1).split("\0");
}

function decodeUtf8(value, label) {
  if (typeof value === "string") return value;
  try {
    return utf8Decoder.decode(value);
  } catch {
    throw new Error(`${label} is not valid UTF-8.`);
  }
}

function safeRelativeParts(path) {
  if (typeof path !== "string" || path.includes("\0") || isAbsolute(path)) {
    throw new Error(`Untracked iOS scan path is not repository-relative: ${JSON.stringify(path)}.`);
  }
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`Untracked iOS scan path contains an unsafe component: ${JSON.stringify(path)}.`);
  }
  return parts;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
