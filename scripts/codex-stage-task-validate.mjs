import { readFile } from "node:fs/promises";
import { cwd } from "node:process";

import {
  StageTaskError,
  buildIssueCommentsSnapshot,
  buildNormalizedTask,
  extractEnvelope,
  gitStatusShort,
  gitRemoteRepository,
  parseArgs,
  parseEnvelopeContent,
  readAllIssueCommentsWithEdits,
  validateEnvelopeObject,
  validateNonEnvelopeText,
} from "./lib/codex-stage.mjs";

async function ghJson(path) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const { stdout } = await execFileAsync(
    "gh",
    ["api", path],
    {
      cwd: cwd(),
      maxBuffer: 10 * 1024 * 1024,
    }
  );
  return JSON.parse(stdout);
}

export async function validateStageIssue({
  issueNumber,
  repositoryFullName,
  localRepositoryPath = cwd(),
  issue,
  comments,
  currentMainSha,
  schema,
  worktreeStatus,
  pullRequest,
  ghCommentsImpl = readAllIssueCommentsWithEdits,
}) {
  const issueData =
    issue ||
    (await ghJson(`repos/${repositoryFullName}/issues/${issueNumber}`));
  const commentData =
    comments ||
    (await ghCommentsImpl({ repositoryFullName, issueNumber }));
  const mainRef =
    currentMainSha ||
    (await ghJson(`repos/${repositoryFullName}/git/ref/heads/main`)).object.sha;
  const stageSchema =
    schema ||
    JSON.parse(
      await readFile(".github/codex/schemas/stage-task.schema.json", "utf8")
    );
  const currentWorktreeStatus =
    worktreeStatus !== undefined
      ? worktreeStatus
      : await gitStatusShort(localRepositoryPath);

  const envelopeMatch = extractEnvelope(issueData.body || "");
  const envelope = parseEnvelopeContent(
    envelopeMatch.language,
    envelopeMatch.content
  );

  validateEnvelopeObject(envelope, stageSchema);
  validateNonEnvelopeText(issueData.body || "", envelopeMatch, commentData);
  const labels = (issueData.labels || [])
    .map((label) => typeof label === "string" ? label : label.name)
    .sort();
  if (JSON.stringify(labels) !== JSON.stringify(["codex:ready"])) {
    throw new StageTaskError(
      "READY_LABEL_SET_INVALID",
      "READY_FOR_CODEX validation requires the complete label set to equal codex:ready",
      { labels }
    );
  }

  let pullRequestData = pullRequest || null;
  if (envelope.expected_pr_number !== undefined && !pullRequestData) {
    pullRequestData = await ghJson(
      `repos/${repositoryFullName}/pulls/${envelope.expected_pr_number}`
    );
  }

  return {
    ...buildNormalizedTask({
    issue: issueData,
    envelope,
    repositoryFullName,
    currentMainSha: mainRef,
    localRepositoryPath,
    worktreeStatus: currentWorktreeStatus,
    pullRequest: pullRequestData,
    }),
    issue_comment_audit: buildIssueCommentsSnapshot(commentData),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.issue) {
    throw new StageTaskError("ISSUE_NUMBER_REQUIRED", "--issue is required");
  }

  const repositoryFullName =
    args.repo || (await gitRemoteRepository(cwd()));
  const normalized = await validateStageIssue({
    issueNumber: Number(args.issue),
    repositoryFullName,
    localRepositoryPath: cwd(),
  });

  if (args.output) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(args.output, `${JSON.stringify(normalized, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(normalized, null, 2)}\n`);
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
