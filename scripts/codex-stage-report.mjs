import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { cwd } from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  StageTaskError,
  buildIssueCommentsSnapshot,
  buildResultComment,
  findManagedResultComments,
  labelsForStatus,
  normalizeResultPayload,
  parseArgs,
  parseEnvelopeContent,
  readAllIssueCommentsWithEdits,
  replaceEnvelopeStatus,
  sha256Utf8,
  extractEnvelope,
  validateEnvelopeObject,
  validateExecutableEnvelope,
} from "./lib/codex-stage.mjs";

const execFileAsync = promisify(execFile);

async function ghJson(path) {
  const { stdout } = await execFileAsync("gh", ["api", path], {
    cwd: cwd(),
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function ghWrite(method, path, fields = {}) {
  const hasStructuredValue = Object.values(fields).some(
    (value) => Array.isArray(value) || (value && typeof value === "object")
  );

  if (!hasStructuredValue) {
    const args = ["api", "--method", method, path];
    for (const [key, value] of Object.entries(fields)) {
      args.push("-f", `${key}=${value}`);
    }
    await execFileAsync("gh", args, {
      cwd: cwd(),
      maxBuffer: 10 * 1024 * 1024,
    });
    return;
  }

  const tempDir = await mkdtemp(join(tmpdir(), "codex-stage-report-"));
  const tempPath = join(tempDir, "payload.json");

  try {
    await writeFile(tempPath, JSON.stringify(fields, null, 2));
    await execFileAsync(
      "gh",
      ["api", "--method", method, path, "--input", tempPath],
      {
        cwd: cwd(),
        maxBuffer: 10 * 1024 * 1024,
      }
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function issueStatus(issueBody) {
  const match = extractEnvelope(issueBody || "");
  return parseEnvelopeContent(match.language, match.content).status;
}

function sortedIssueLabels(issue) {
  return (issue.labels || []).map((label) => typeof label === "string" ? label : label.name).sort();
}

function pullRequestFingerprint(pullRequest) {
  return {
    state: pullRequest?.state ?? null,
    merged: pullRequest?.merged ?? null,
    draft: pullRequest?.draft ?? null,
    base_sha: pullRequest?.base?.sha ?? null,
    base_ref: pullRequest?.base?.ref ?? null,
    head_sha: pullRequest?.head?.sha ?? null,
    head_ref: pullRequest?.head?.ref ?? null,
  };
}

function assertExpectedPullRequest(pullRequest, expected, code = "REPORT_PR_LIFECYCLE_INVALID") {
  const actual = pullRequestFingerprint(pullRequest);
  if (!sameJson(actual, expected)) {
    throw new StageTaskError(code, "Pull request lifecycle, base, or head does not match the expected reporter snapshot", {
      actual,
      expected,
    });
  }
  return actual;
}

function inspectManagedMarkers(comments, stageId) {
  const marker = `<!-- codex-stage-result:${stageId} -->`;
  const exact = [];
  const impostors = [];
  for (const comment of comments) {
    const body = comment.body || "";
    const exactCount = body.split(marker).length - 1;
    for (let index = 0; index < exactCount; index += 1) exact.push(comment);
    const markerLike = /<!--[\s\S]*?codex[\s_-]*stage[\s_-]*result[\s\S]*?-->/gi;
    for (const match of body.matchAll(markerLike)) {
      if (match[0] !== marker) impostors.push({ comment_id: comment.id, marker: match[0] });
    }
  }
  if (impostors.length > 0) {
    throw new StageTaskError("RESULT_COMMENT_MARKER_IMPOSTOR", "Managed result marker variant is forbidden", {
      impostors,
    });
  }
  if (exact.length > 1) {
    throw new StageTaskError("RESULT_COMMENT_DUPLICATE", "Multiple managed result markers already exist", {
      commentIds: exact.map((comment) => comment.id),
    });
  }
  const managed = exact[0] || null;
  return {
    count: exact.length,
    comment: managed,
    state: managed ? "PRESENT" : "ABSENT",
    id: managed?.id ?? null,
    body_sha256: managed ? sha256Utf8(managed.body || "") : null,
  };
}

function buildReporterState({ issue, comments, stageId, pullRequest }) {
  const status = issueStatus(issue.body || "");
  const labels = sortedIssueLabels(issue);
  const managed = inspectManagedMarkers(comments, stageId);
  const commentAudit = buildIssueCommentsSnapshot(comments);
  const managedFingerprint = commentAudit.fingerprints.find(({ id }) => id === managed.id) || null;
  return {
    issue_state: issue.state ?? null,
    envelope_status: status,
    issue_body_sha256: sha256Utf8(issue.body || ""),
    labels,
    all_issue_comments: commentAudit,
    managed_result_comment: {
      state: managed.state,
      id: managed.id,
      body_sha256: managed.body_sha256,
      updated_at: managedFingerprint?.updated_at ?? null,
      last_edited_at: managedFingerprint?.last_edited_at ?? null,
      user_content_edits_total_count: managedFingerprint?.user_content_edits_total_count ?? 0,
      complete_edit_history: managedFingerprint?.complete_edit_history ?? [],
    },
    pull_request: pullRequestFingerprint(pullRequest),
  };
}

export function buildReporterSnapshot({ issue, comments, stageId, pullRequest }) {
  const snapshot = buildReporterState({ issue, comments, stageId, pullRequest });
  const expectedLabels = labelsForStatus(snapshot.envelope_status);
  if (snapshot.issue_state !== "open") {
    throw new StageTaskError("REPORT_SOURCE_ISSUE_STATE_INVALID", "Reporter requires an open source Issue", {
      issue_state: snapshot.issue_state,
    });
  }
  if (snapshot.envelope_status !== "CODEX_RUNNING") {
    throw new StageTaskError("REPORT_SOURCE_STATUS_INVALID", "Reporter can write only from CODEX_RUNNING", {
      stageStatus: snapshot.envelope_status,
    });
  }
  if (JSON.stringify(snapshot.labels) !== JSON.stringify(expectedLabels)) {
    throw new StageTaskError("REPORT_SOURCE_LABELS_INVALID", "Reporter requires the complete CODEX_RUNNING label set", {
      labels: snapshot.labels,
      expectedLabels,
    });
  }
  if (
    snapshot.pull_request.state !== "open" ||
    snapshot.pull_request.merged !== false ||
    snapshot.pull_request.draft !== false
  ) {
    throw new StageTaskError(
      "REPORT_SOURCE_PR_LIFECYCLE_INVALID",
      "Reporter requires an open, unmerged, non-draft pull request",
      { pull_request: snapshot.pull_request }
    );
  }
  return snapshot;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function fingerprintMap(snapshot) {
  return new Map(snapshot.fingerprints.map((fingerprint) => [fingerprint.id, fingerprint]));
}

function onlyExpectedManagedCommentChange({ before, after, expectedCommentBody }) {
  const beforeAudit = before.all_issue_comments;
  const beforeMap = fingerprintMap(beforeAudit);
  const afterMap = fingerprintMap(after);
  const managedBefore = before.managed_result_comment;
  const expectedHash = sha256Utf8(expectedCommentBody);
  const expectedAfterCount = managedBefore.state === "PRESENT"
    ? beforeAudit.total_count
    : beforeAudit.total_count + 1;
  if (after.total_count !== expectedAfterCount) return false;
  for (const [id, fingerprint] of beforeMap) {
    if (id === managedBefore.id) continue;
    if (!sameJson(afterMap.get(id), fingerprint)) return false;
  }
  if (managedBefore.state === "ABSENT") {
    const created = after.fingerprints.filter(({ id }) => !beforeMap.has(id));
    return created.length === 1 &&
      created[0].body_sha256 === expectedHash &&
      created[0].last_edited_at === null &&
      created[0].user_content_edits_total_count === 0 &&
      created[0].complete_edit_history.length === 0;
  }
  const updated = afterMap.get(managedBefore.id);
  const beforeFingerprint = beforeMap.get(managedBefore.id);
  if (!updated || !beforeFingerprint) return false;
  return updated.body_sha256 === expectedHash &&
    updated.updated_at === updated.last_edited_at &&
    updated.last_edited_at !== beforeFingerprint.last_edited_at &&
    updated.user_content_edits_total_count === beforeFingerprint.user_content_edits_total_count + 1 &&
    updated.complete_edit_history.length === beforeFingerprint.complete_edit_history.length + 1 &&
    updated.complete_edit_history[0]?.edited_at === updated.last_edited_at &&
    sameJson(updated.complete_edit_history.slice(1), beforeFingerprint.complete_edit_history);
}

async function readReporterSweep({
  repositoryFullName,
  issueNumber,
  prNumber,
  ghJsonImpl,
  ghCommentsImpl,
}) {
  const values = await Promise.allSettled([
    ghJsonImpl(`repos/${repositoryFullName}/issues/${issueNumber}`),
    ghCommentsImpl({ repositoryFullName, issueNumber }),
    ghJsonImpl(`repos/${repositoryFullName}/pulls/${prNumber}`),
  ]);
  const failures = values
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => result.status === "rejected")
    .map(({ index, result }) => ({
      index,
      message: result.reason?.message ?? String(result.reason),
    }));
  if (failures.length > 0) return { ok: false, failures };
  return {
    ok: true,
    issue: values[0].value,
    comments: values[1].value,
    pull_request: values[2].value,
  };
}

async function readStableReporterSweeps({
  repositoryFullName,
  issueNumber,
  prNumber,
  stageId,
  ghJsonImpl,
  ghCommentsImpl,
  phase,
  requireRunning,
}) {
  const sweeps = [];
  for (let index = 0; index < 2; index += 1) {
    const sweep = await readReporterSweep({
      repositoryFullName,
      issueNumber,
      prNumber,
      ghJsonImpl,
      ghCommentsImpl,
    });
    if (!sweep.ok) {
      throw new StageTaskError(
        phase === "prewrite" ? "REPORT_PREWRITE_OUTCOME_C" : "REPORT_RECONCILIATION_OUTCOME_C",
        `${phase} reporter sweep could not be read completely`,
        { outcome: "C", reason: "readback_failed_or_uncertain", sweep: index + 1, failures: sweep.failures }
      );
    }
    let snapshot;
    try {
      const input = {
        issue: sweep.issue,
        comments: sweep.comments,
        stageId,
        pullRequest: sweep.pull_request,
      };
      snapshot = requireRunning ? buildReporterSnapshot(input) : buildReporterState(input);
    } catch (error) {
      throw new StageTaskError(
        phase === "prewrite" ? "REPORT_PREWRITE_OUTCOME_C" : "REPORT_RECONCILIATION_OUTCOME_C",
        `${phase} reporter sweep could not be fingerprinted completely`,
        {
          outcome: "C",
          reason: error.code ?? "snapshot_failed",
          sweep: index + 1,
          details: error.details ?? {},
        }
      );
    }
    sweeps.push({ ...sweep, snapshot });
  }
  if (!sameJson(sweeps[0].snapshot, sweeps[1].snapshot)) {
    throw new StageTaskError(
      phase === "prewrite" ? "REPORT_PREWRITE_OUTCOME_C" : "REPORT_RECONCILIATION_OUTCOME_C",
      `${phase} reporter sweeps were not identical`,
      {
        outcome: "C",
        reason: "double_sweep_mismatch",
        first: sweeps[0].snapshot,
        second: sweeps[1].snapshot,
      }
    );
  }
  return {
    sweep_count: 2,
    snapshot: sweeps[1].snapshot,
    issue: sweeps[1].issue,
    comments: sweeps[1].comments,
    pull_request: sweeps[1].pull_request,
  };
}

export function classifyReporterReadback({
  before,
  afterIssue,
  afterComments,
  afterPullRequest,
  stageId,
  expectedStatus,
  expectedLabels,
  expectedCommentBody,
  expectedIssueBody,
}) {
  const afterStatus = issueStatus(afterIssue.body || "");
  const labels = sortedIssueLabels(afterIssue);
  let managed;
  try {
    managed = inspectManagedMarkers(afterComments, stageId);
  } catch (error) {
    return { outcome: "C", reason: error.code, details: error.details || {} };
  }
  let afterAudit;
  try {
    afterAudit = buildIssueCommentsSnapshot(afterComments);
  } catch (error) {
    return { outcome: "C", reason: error.code, details: error.details || {} };
  }
  const afterPullRequestFingerprint = pullRequestFingerprint(afterPullRequest);
  const expectedBodyHash = sha256Utf8(expectedCommentBody);
  const idIsExpected = before.managed_result_comment.state === "PRESENT"
    ? managed.id === before.managed_result_comment.id
    : managed.state === "PRESENT";
  const isA =
    afterIssue.state === before.issue_state &&
    afterStatus === expectedStatus &&
    sha256Utf8(afterIssue.body || "") === sha256Utf8(expectedIssueBody) &&
    JSON.stringify(labels) === JSON.stringify([...expectedLabels].sort()) &&
    sameJson(afterPullRequestFingerprint, before.pull_request) &&
    managed.count === 1 &&
    idIsExpected &&
    managed.body_sha256 === expectedBodyHash &&
    onlyExpectedManagedCommentChange({
      before,
      after: afterAudit,
      expectedCommentBody,
    });
  if (isA) return { outcome: "A", reason: "complete_intended_result" };

  const isB =
    afterIssue.state === before.issue_state &&
    afterStatus === before.envelope_status &&
    sha256Utf8(afterIssue.body || "") === before.issue_body_sha256 &&
    JSON.stringify(labels) === JSON.stringify(before.labels) &&
    sameJson(afterPullRequestFingerprint, before.pull_request) &&
    sameJson(afterAudit, before.all_issue_comments);
  if (isB) return { outcome: "B", reason: "confirmed_zero_write" };
  return {
    outcome: "C",
    reason: "partial_or_inconsistent_write",
    details: {
      after_status: afterStatus,
      after_issue_state: afterIssue.state ?? null,
      after_labels: labels,
      after_pull_request: afterPullRequestFingerprint,
      managed_comment_count: managed.count,
      managed_comment_id: managed.id,
      managed_comment_body_sha256: managed.body_sha256,
      expected_comment_body_sha256: expectedBodyHash,
      after_comment_audit: afterAudit,
    },
  };
}

export async function reportStageResult({
  repositoryFullName,
  issueNumber,
  resultPayload,
  write = false,
  issue,
  comments,
  ghJsonImpl = ghJson,
  ghWriteImpl = ghWrite,
  ghCommentsImpl = readAllIssueCommentsWithEdits,
  pullRequest,
  schema,
}) {
  const issueData =
    issue ||
    (await ghJsonImpl(`repos/${repositoryFullName}/issues/${issueNumber}`));
  const stageSchema =
    schema ||
    JSON.parse(
      await readFile(".github/codex/schemas/stage-task.schema.json", "utf8")
    );
  const commentData =
    comments ||
    (await ghCommentsImpl({ repositoryFullName, issueNumber }));
  const envelopeMatch = extractEnvelope(issueData.body || "");
  const envelope = parseEnvelopeContent(
    envelopeMatch.language,
    envelopeMatch.content
  );
  validateEnvelopeObject(envelope, stageSchema);
  const externalReadonlyAuthorization = validateExecutableEnvelope(envelope);
  const normalizedPayload = normalizeResultPayload(resultPayload, {
    externalReadonlyAuthorization,
  });

  if (issueData.state !== "open") {
    throw new StageTaskError("ISSUE_NOT_OPEN", "Stage issue must remain open while reporting", {
      issueNumber: issueData.number,
      state: issueData.state,
    });
  }
  if (envelope.repository !== repositoryFullName) {
    throw new StageTaskError(
      "REPORT_REPOSITORY_MISMATCH",
      "Reporter repository does not match the issue envelope",
      {
        expectedRepository: envelope.repository,
        actualRepository: repositoryFullName,
      }
    );
  }
  if (normalizedPayload.stage_id !== envelope.stage_id) {
    throw new StageTaskError("REPORT_STAGE_ID_MISMATCH", "Result stage_id does not match the issue envelope", {
      expectedStageId: envelope.stage_id,
      actualStageId: normalizedPayload.stage_id,
    });
  }
  if (normalizedPayload.main_sha !== envelope.expected_main_sha) {
    throw new StageTaskError("REPORT_MAIN_SHA_MISMATCH", "Result main_sha does not match the issue envelope", {
      expectedMainSha: envelope.expected_main_sha,
      actualMainSha: normalizedPayload.main_sha,
    });
  }
  if (normalizedPayload.branch !== envelope.branch) {
    throw new StageTaskError("REPORT_BRANCH_MISMATCH", "Result branch does not match the issue envelope", {
      expectedBranch: envelope.branch,
      actualBranch: normalizedPayload.branch,
    });
  }

  const nextStatus = normalizedPayload.next_status;
  const nextLabels = labelsForStatus(nextStatus);
  const commentBody = buildResultComment(normalizedPayload);
  const expectedPullRequest = {
    state: "open",
    merged: false,
    draft: false,
    base_sha: envelope.expected_pr_base_sha ?? envelope.expected_main_sha,
    base_ref: "main",
    head_sha: normalizedPayload.exact_pr_head_sha,
    head_ref: envelope.branch,
  };
  const initialPrData = pullRequest || (
    write
      ? await ghJsonImpl(`repos/${repositoryFullName}/pulls/${normalizedPayload.pr_number}`)
      : {
          state: "open",
          merged: false,
          draft: false,
          base: { sha: expectedPullRequest.base_sha, ref: expectedPullRequest.base_ref },
          head: { sha: expectedPullRequest.head_sha, ref: expectedPullRequest.head_ref },
        }
  );
  assertExpectedPullRequest(initialPrData, expectedPullRequest, "REPORT_PR_HEAD_MISMATCH");

  let effectiveIssue = issueData;
  let effectiveComments = commentData;
  let effectivePr = initialPrData;
  let prewriteSweepCount = 1;
  let prewriteSnapshot;
  if (write) {
    const stablePrewrite = await readStableReporterSweeps({
      repositoryFullName,
      issueNumber,
      prNumber: normalizedPayload.pr_number,
      stageId: normalizedPayload.stage_id,
      ghJsonImpl,
      ghCommentsImpl,
      phase: "prewrite",
      requireRunning: true,
    });
    if (
      stablePrewrite.snapshot.issue_body_sha256 !== sha256Utf8(issueData.body || "") ||
      !sameJson(stablePrewrite.snapshot.pull_request, expectedPullRequest)
    ) {
      throw new StageTaskError(
        "REPORT_PREWRITE_OUTCOME_C",
        "Fresh prewrite state drifted from the validated Issue body or exact PR head",
        {
          outcome: "C",
          reason: "validated_state_drift",
          validated_issue_body_sha256: sha256Utf8(issueData.body || ""),
          fresh_issue_body_sha256: stablePrewrite.snapshot.issue_body_sha256,
          expected_pull_request: expectedPullRequest,
          fresh_pull_request: stablePrewrite.snapshot.pull_request,
        }
      );
    }
    effectiveIssue = stablePrewrite.issue;
    effectiveComments = stablePrewrite.comments;
    effectivePr = stablePrewrite.pull_request;
    prewriteSweepCount = stablePrewrite.sweep_count;
    prewriteSnapshot = stablePrewrite.snapshot;
  } else {
    prewriteSnapshot = buildReporterSnapshot({
      issue: effectiveIssue,
      comments: effectiveComments,
      stageId: normalizedPayload.stage_id,
      pullRequest: effectivePr,
    });
  }

  const managedComments = findManagedResultComments(
    effectiveComments,
    normalizedPayload.stage_id
  );
  if (managedComments.length > 1) {
    throw new StageTaskError(
      "RESULT_COMMENT_DUPLICATE",
      "Multiple managed result comments already exist",
      {
        commentIds: managedComments.map((comment) => comment.id),
      }
    );
  }
  const nextIssueBody = replaceEnvelopeStatus(effectiveIssue.body || "", nextStatus);

  const summary = {
    next_status: nextStatus,
    next_labels: nextLabels,
    comment_action:
      managedComments.length === 1 ? "update_existing_comment" : "create_comment",
    comment_body: commentBody,
    issue_body: nextIssueBody,
    prewrite_snapshot: prewriteSnapshot,
    prewrite_comment_sweep_count: prewriteSweepCount,
  };

  if (!write) {
    return summary;
  }

  let writeError = null;
  try {
    if (managedComments.length === 1) {
      await ghWriteImpl(
        "PATCH",
        `repos/${repositoryFullName}/issues/comments/${managedComments[0].id}`,
        { body: commentBody }
      );
    } else {
      await ghWriteImpl(
        "POST",
        `repos/${repositoryFullName}/issues/${issueNumber}/comments`,
        {
          body: commentBody,
        }
      );
    }
    await ghWriteImpl("PATCH", `repos/${repositoryFullName}/issues/${issueNumber}`, {
      body: nextIssueBody,
      labels: nextLabels,
    });
  } catch (error) {
    writeError = error;
  }

  let stableReadback;
  try {
    stableReadback = await readStableReporterSweeps({
      repositoryFullName,
      issueNumber,
      prNumber: normalizedPayload.pr_number,
      stageId: normalizedPayload.stage_id,
      ghJsonImpl,
      ghCommentsImpl,
      phase: "readback",
      requireRunning: false,
    });
  } catch (error) {
    if (error instanceof StageTaskError) {
      error.details = {
        ...error.details,
        write_error: writeError?.message ?? null,
      };
    }
    throw error;
  }
  const reconciliation = classifyReporterReadback({
    before: prewriteSnapshot,
    afterIssue: stableReadback.issue,
    afterComments: stableReadback.comments,
    afterPullRequest: stableReadback.pull_request,
    stageId: normalizedPayload.stage_id,
    expectedStatus: nextStatus,
    expectedLabels: nextLabels,
    expectedCommentBody: commentBody,
    expectedIssueBody: nextIssueBody,
  });
  if (reconciliation.outcome === "C") {
    throw new StageTaskError("REPORT_RECONCILIATION_OUTCOME_C", "Reporter read-back found a partial or inconsistent write", reconciliation);
  }
  return {
    ...summary,
    reconciliation,
    readback_comment_sweep_count: stableReadback.sweep_count,
    write_call_error: writeError
      ? { name: writeError.name, code: writeError.code ?? null, message: writeError.message }
      : null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.issue || !args.input) {
    throw new StageTaskError("REPORT_ARGS_REQUIRED", "--issue and --input are required");
  }

  const repositoryFullName = args.repo || "guijixingqiu/investment-assistant-system";
  const resultPayload = JSON.parse(await readFile(args.input, "utf8"));
  const summary = await reportStageResult({
    repositoryFullName,
    issueNumber: Number(args.issue),
    resultPayload,
    write: Boolean(args.write),
  });

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    const payload = {
      ok: false,
      code: error.code || "UNEXPECTED_ERROR",
      message: error.message,
      details: error.details || {},
    };
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exit(1);
  });
}
