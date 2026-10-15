import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { posix as pathPosix } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const STAGE_STATUSES = [
  "READY_FOR_CODEX",
  "CODEX_RUNNING",
  "BLOCKED",
  "READY_FOR_CHATGPT_REVIEW",
  "CHANGES_REQUESTED",
  "READY_FOR_MERGE",
  "MERGED",
  "CANCELLED",
];

export const RESULT_VALUES = ["BLOCKED", "PR_CREATED_FOR_REVIEW"];
export const RESULT_TO_NEXT_STATUS = {
  BLOCKED: "BLOCKED",
  PR_CREATED_FOR_REVIEW: "READY_FOR_CHATGPT_REVIEW",
};

export const CONTROLLED_LABELS = [
  "codex:ready",
  "codex:running",
  "chatgpt:review",
  "codex:blocked",
  "owner:merge",
  "stage:done",
];

const ENVELOPE_KEYWORDS = ["protocol_version", "stage_id", "status", "repository"];
const DIRECTIVE_PHRASES = [
  /ignore (?:the )?(?:stage envelope|yaml envelope|json envelope|previous instructions)/i,
  /treat this comment as authoritative/i,
  /override the envelope/i,
];
const EXECUTABLE_TASK_REQUIRED_FIELDS = [
  "objective",
  "allowed_paths",
  "forbidden_paths",
  "forbidden_actions",
  "acceptance_criteria",
  "required_validation_commands",
];
const SHA1_PATTERN = /^[0-9a-f]{40}$/;
const FORMAL_REPOSITORY_ROOT = "/Users/REDACTED/Documents/investment-assistant-system";
const LEGACY_READONLY_ROOT = "/Users/REDACTED/Documents/开发辅助交易系统2.0";
const EXTERNAL_READONLY_FIELDS = [
  "external_readonly_paths",
  "external_readonly_purpose",
  "external_readonly_owner_authorized",
  "external_readonly_write_allowed",
  "external_readonly_execution_allowed",
  "external_readonly_network_allowed",
  "external_readonly_follow_symlinks",
  "external_readonly_sensitive_content_allowed",
];

export class StageTaskError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "StageTaskError";
    this.code = code;
    this.details = details;
  }
}

const ISSUE_COMMENT_EDITS_QUERY = `query($nodeId: ID!, $cursor: String) {
  node(id: $nodeId) {
    ... on IssueComment {
      id
      databaseId
      body
      updatedAt
      lastEditedAt
      userContentEdits(first: 100, after: $cursor) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          createdAt
          updatedAt
          editedAt
          deletedAt
          diff
          editor { login }
          deletedBy { login }
        }
      }
    }
  }
}`;

async function defaultGhJson(args) {
  const { stdout } = await execFileAsync("gh", args, {
    cwd: process.cwd(),
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export function sha256Utf8(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeEditRecord(edit) {
  if (
    !edit ||
    typeof edit.id !== "string" ||
    edit.id.length === 0 ||
    typeof edit.createdAt !== "string" ||
    typeof edit.updatedAt !== "string" ||
    typeof edit.editedAt !== "string"
  ) {
    throw new StageTaskError(
      "COMMENT_EDIT_HISTORY_INVALID",
      "Every GitHub userContentEdits record must expose its complete identity and timestamps"
    );
  }
  return {
    id: edit.id,
    created_at: edit.createdAt,
    updated_at: edit.updatedAt,
    edited_at: edit.editedAt,
    deleted_at: edit.deletedAt ?? null,
    editor_login: edit.editor?.login ?? null,
    deleted_by_login: edit.deletedBy?.login ?? null,
    diff_sha256: edit.diff === null || edit.diff === undefined
      ? null
      : sha256Utf8(edit.diff),
  };
}

export async function readAllIssueCommentsWithEdits({
  repositoryFullName,
  issueNumber,
  runGhJson = defaultGhJson,
}) {
  const endpoint = `repos/${repositoryFullName}/issues/${issueNumber}/comments`;
  const pages = await runGhJson(["api", "--paginate", "--slurp", endpoint]);
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw new StageTaskError(
      "COMMENT_PAGINATION_INVALID",
      "The complete paginated Issue comment response must be an array of pages"
    );
  }
  const comments = pages.flat();
  const result = [];
  for (const comment of comments) {
    if (!Number.isInteger(comment.id) || typeof comment.node_id !== "string") {
      throw new StageTaskError(
        "COMMENT_IDENTITY_INVALID",
        "Every paginated Issue comment must expose database and GraphQL node IDs",
        { comment_id: comment.id ?? null }
      );
    }
    const editRecords = [];
    const seenEditIds = new Set();
    const seenCursors = new Set();
    let cursor = null;
    let graphComment = null;
    let declaredTotal = null;
    do {
      const args = [
        "api",
        "graphql",
        "-F",
        `nodeId=${comment.node_id}`,
        "-f",
        `query=${ISSUE_COMMENT_EDITS_QUERY}`,
      ];
      if (cursor !== null) args.push("-f", `cursor=${cursor}`);
      const response = await runGhJson(args);
      const node = response?.data?.node;
      const edits = node?.userContentEdits;
      if (
        !node ||
        node.databaseId !== comment.id ||
        node.id !== comment.node_id ||
        typeof node.body !== "string" ||
        typeof node.updatedAt !== "string" ||
        !edits ||
        !Number.isInteger(edits.totalCount) ||
        !Array.isArray(edits.nodes) ||
        typeof edits.pageInfo?.hasNextPage !== "boolean"
      ) {
        throw new StageTaskError(
          "COMMENT_EDIT_HISTORY_INVALID",
          "GitHub returned incomplete Issue comment edit-history metadata",
          { comment_id: comment.id }
        );
      }
      if (
        node.body !== (comment.body || "") ||
        node.updatedAt !== comment.updated_at
      ) {
        throw new StageTaskError(
          "COMMENT_REST_GRAPHQL_MISMATCH",
          "REST and GraphQL Issue comment snapshots must describe the same fresh object",
          { comment_id: comment.id }
        );
      }
      graphComment = node;
      declaredTotal ??= edits.totalCount;
      if (declaredTotal !== edits.totalCount) {
        throw new StageTaskError(
          "COMMENT_EDIT_HISTORY_CHANGED_DURING_READ",
          "Issue comment edit count changed while pagination was in progress",
          { comment_id: comment.id }
        );
      }
      const normalizedEdits = edits.nodes.map(normalizeEditRecord);
      for (const edit of normalizedEdits) {
        if (seenEditIds.has(edit.id)) {
          throw new StageTaskError(
            "COMMENT_EDIT_ID_DUPLICATE",
            "Issue comment edit-history IDs must be globally unique across every page",
            { comment_id: comment.id, edit_id: edit.id }
          );
        }
        seenEditIds.add(edit.id);
        editRecords.push(edit);
      }
      if (!edits.pageInfo.hasNextPage) {
        cursor = null;
      } else {
        const next = edits.pageInfo.endCursor;
        if (typeof next !== "string" || seenCursors.has(next)) {
          throw new StageTaskError(
            "COMMENT_EDIT_PAGINATION_CURSOR_INVALID",
            "Issue comment edit history did not provide a unique next cursor",
            { comment_id: comment.id }
          );
        }
        seenCursors.add(next);
        cursor = next;
      }
    } while (cursor !== null);
    if (editRecords.length !== declaredTotal) {
      throw new StageTaskError(
        "COMMENT_EDIT_HISTORY_INCOMPLETE",
        "Issue comment edit-history pagination did not return every declared record",
        { comment_id: comment.id, declared_total: declaredTotal, actual_total: editRecords.length }
      );
    }
    result.push({
      ...comment,
      body: graphComment.body,
      updated_at: graphComment.updatedAt,
      lastEditedAt: graphComment.lastEditedAt ?? null,
      userContentEdits: {
        totalCount: declaredTotal,
        nodes: editRecords,
      },
    });
  }
  return result;
}

export function buildIssueCommentsSnapshot(comments) {
  if (!Array.isArray(comments)) {
    throw new StageTaskError(
      "COMMENT_PAGINATION_INVALID",
      "Issue comments must be a complete paginated array"
    );
  }
  const fingerprints = comments.map((comment) => {
    const edits = comment.userContentEdits;
    if (
      !Number.isInteger(comment.id) ||
      typeof comment.body !== "string" ||
      typeof comment.updated_at !== "string" ||
      !Object.hasOwn(comment, "lastEditedAt") ||
      !edits ||
      !Number.isInteger(edits.totalCount) ||
      !Array.isArray(edits.nodes) ||
      edits.nodes.length !== edits.totalCount
    ) {
      throw new StageTaskError(
        "COMMENT_AUDIT_BINDING_INCOMPLETE",
        "Every Issue comment must bind body, update time, last edit, count, and complete edit history",
        { comment_id: comment.id ?? null }
      );
    }
    const editIds = edits.nodes.map(({ id }) => id);
    if (
      editIds.some((id) => typeof id !== "string" || id.length === 0) ||
      new Set(editIds).size !== editIds.length
    ) {
      throw new StageTaskError(
        "COMMENT_EDIT_ID_DUPLICATE",
        "Issue comment snapshots require non-empty globally unique edit IDs",
        { comment_id: comment.id }
      );
    }
    return {
      id: comment.id,
      body_sha256: sha256Utf8(comment.body),
      updated_at: comment.updated_at,
      last_edited_at: comment.lastEditedAt,
      user_content_edits_total_count: edits.totalCount,
      complete_edit_history: edits.nodes,
    };
  }).sort((left, right) => left.id - right.id);
  if (new Set(fingerprints.map(({ id }) => id)).size !== fingerprints.length) {
    throw new StageTaskError(
      "COMMENT_IDENTITY_DUPLICATE",
      "Complete Issue comment pagination returned a duplicate comment ID"
    );
  }
  return {
    pagination_complete: true,
    total_count: fingerprints.length,
    fingerprints,
  };
}

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

export function normalizeRepositoryRemote(remoteUrl) {
  const sshMatch = remoteUrl.match(/^git@github\.com:(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return sshMatch[1];
  }

  const httpsMatch = remoteUrl.match(
    /^https:\/\/github\.com\/(.+?)(?:\.git)?$/
  );
  if (httpsMatch) {
    return httpsMatch[1];
  }

  throw new StageTaskError("REMOTE_REPOSITORY_UNSUPPORTED", "Unsupported remote URL", {
    remoteUrl,
  });
}

export function extractEnvelope(body) {
  const fenceRegex = /```(yaml|yml|json)\n([\s\S]*?)\n```/g;
  const matches = [];
  for (const match of body.matchAll(fenceRegex)) {
    if (!ENVELOPE_KEYWORDS.every((keyword) => match[2].includes(keyword))) {
      continue;
    }
    matches.push({
      language: match[1],
      raw: match[0],
      content: match[2],
      index: match.index,
    });
  }

  if (matches.length === 0) {
    throw new StageTaskError("ENVELOPE_MISSING", "Stage envelope fence was not found");
  }

  if (matches.length > 1) {
    throw new StageTaskError(
      "ENVELOPE_DUPLICATE",
      "Exactly one stage envelope is required",
      {
        matches: matches.length,
      }
    );
  }

  return matches[0];
}

export function parseEnvelopeContent(language, content) {
  if (language === "json") {
    try {
      return JSON.parse(content);
    } catch (error) {
      throw new StageTaskError("ENVELOPE_JSON_INVALID", "Invalid JSON stage envelope", {
        reason: error.message,
      });
    }
  }

  return parseFlatYaml(content);
}

export function parseFlatYaml(content) {
  const result = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    if (/^\s/.test(line)) {
      throw new StageTaskError("ENVELOPE_YAML_NESTED", "Nested YAML is not allowed");
    }

    const separator = line.indexOf(":");
    if (separator <= 0) {
      throw new StageTaskError("ENVELOPE_YAML_LINE_INVALID", "Invalid YAML line", {
        line,
      });
    }

    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    result[key] = parseYamlScalar(rawValue);
  }
  return result;
}

function parseYamlScalar(rawValue) {
  if (rawValue === "true") {
    return true;
  }
  if (rawValue === "false") {
    return false;
  }
  if (/^-?\d+$/.test(rawValue)) {
    return Number(rawValue);
  }
  if (
    (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
    (rawValue.startsWith("'") && rawValue.endsWith("'"))
  ) {
    return rawValue.slice(1, -1);
  }
  if (
    (rawValue.startsWith("[") && rawValue.endsWith("]")) ||
    (rawValue.startsWith("{") && rawValue.endsWith("}"))
  ) {
    try {
      return JSON.parse(rawValue);
    } catch (error) {
      throw new StageTaskError(
        "ENVELOPE_YAML_SCALAR_JSON_INVALID",
        "Invalid JSON literal inside YAML stage envelope",
        {
          rawValue,
          reason: error.message,
        }
      );
    }
  }
  return rawValue;
}

export function validateSchemaDefinition(schema) {
  if (!schema || schema.type !== "object" || !schema.properties || !schema.required) {
    throw new StageTaskError("SCHEMA_INVALID", "Stage schema definition is invalid");
  }
}

export function validateEnvelopeObject(envelope, schema) {
  validateSchemaDefinition(schema);

  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new StageTaskError("ENVELOPE_NOT_OBJECT", "Stage envelope must be an object");
  }

  const errors = [];
  for (const key of schema.required) {
    if (!(key in envelope)) {
      errors.push(`missing required key ${key}`);
    }
  }

  for (const [key, value] of Object.entries(envelope)) {
    const property = schema.properties[key];
    if (!property) {
      errors.push(`unexpected key ${key}`);
      continue;
    }
    validateProperty(errors, key, value, property);
  }

  if (errors.length > 0) {
    throw new StageTaskError("ENVELOPE_SCHEMA_INVALID", "Stage envelope failed schema validation", {
      errors,
    });
  }
}

function validateProperty(errors, key, value, property) {
  if (property.type === "integer") {
    if (!Number.isInteger(value)) {
      errors.push(`${key} must be an integer`);
      return;
    }
  } else if (property.type === "boolean") {
    if (typeof value !== "boolean") {
      errors.push(`${key} must be a boolean`);
      return;
    }
  } else if (property.type === "string") {
    if (typeof value !== "string") {
      errors.push(`${key} must be a string`);
      return;
    }
  } else if (property.type === "array") {
    if (!Array.isArray(value)) {
      errors.push(`${key} must be an array`);
      return;
    }
    if (property.minItems !== undefined && value.length < property.minItems) {
      errors.push(`${key} must contain at least ${property.minItems} item(s)`);
    }
    if (property.uniqueItems) {
      const uniqueSize = new Set(value).size;
      if (uniqueSize !== value.length) {
        errors.push(`${key} must contain unique items`);
      }
    }
    if (property.items) {
      for (const item of value) {
        if (property.items.type === "string" && typeof item !== "string") {
          errors.push(`${key} items must be strings`);
        }
      }
    }
  }

  if (property.const !== undefined && value !== property.const) {
    errors.push(`${key} must equal ${property.const}`);
  }
  if (property.enum && !property.enum.includes(value)) {
    errors.push(`${key} must be one of ${property.enum.join(", ")}`);
  }
  if (property.pattern && typeof value === "string") {
    const pattern = new RegExp(property.pattern);
    if (!pattern.test(value)) {
      errors.push(`${key} does not match ${property.pattern}`);
    }
  }
  if (property.minimum !== undefined && typeof value === "number" && value < property.minimum) {
    errors.push(`${key} must be >= ${property.minimum}`);
  }
  if (property.minLength !== undefined && typeof value === "string" && value.length < property.minLength) {
    errors.push(`${key} must have length >= ${property.minLength}`);
  }
}

export function findConflictingDirectives(text) {
  const conflicts = [];
  for (const phrase of DIRECTIVE_PHRASES) {
    const match = text.match(phrase);
    if (match) {
      conflicts.push(match[0]);
    }
  }

  const envelopeLikeMatches = [
    ...text.matchAll(
      /(^|\n)\s*(protocol_version|stage_id|status|repository|expected_main_sha)\s*:\s*(.+)/g
    ),
  ];
  for (const match of envelopeLikeMatches) {
    conflicts.push(match[0].trim());
  }
  return conflicts;
}

export function validateNonEnvelopeText(issueBody, envelopeMatch, comments = []) {
  const before = issueBody.slice(0, envelopeMatch.index);
  const after = issueBody.slice(envelopeMatch.index + envelopeMatch.raw.length);
  const bodyConflicts = findConflictingDirectives(`${before}\n${after}`);
  if (bodyConflicts.length > 0) {
    throw new StageTaskError(
      "BODY_CONFLICTING_DIRECTIVE",
      "Issue body contains conflicting instruction text outside the envelope",
      {
        conflicts: bodyConflicts,
      }
    );
  }

  for (const comment of comments) {
    const conflicts = findConflictingDirectives(comment.body || "");
    if (conflicts.length > 0) {
      throw new StageTaskError(
        "COMMENT_CONFLICTING_DIRECTIVE",
        "Issue comments are non-authoritative and cannot carry conflicting task directives",
        {
          commentId: comment.id,
          conflicts,
        }
      );
    }
  }
}

export function validateExecutableEnvelope(envelope) {
  if (envelope.owner_merge_authorization_required !== true) {
    throw new StageTaskError(
      "OWNER_MERGE_AUTHORIZATION_REQUIRED",
      "Stage envelope must require explicit owner merge authorization"
    );
  }

  if (envelope.auto_merge_allowed !== false) {
    throw new StageTaskError(
      "AUTO_MERGE_FORBIDDEN",
      "Stage envelope must forbid auto-merge"
    );
  }

  const missingFields = EXECUTABLE_TASK_REQUIRED_FIELDS.filter((field) => {
    const value = envelope[field];
    if (typeof value === "string") {
      return value.trim().length === 0;
    }
    if (Array.isArray(value)) {
      return value.length === 0;
    }
    return value === undefined;
  });

  if (missingFields.length > 0) {
    throw new StageTaskError(
      "EXECUTABLE_TASK_FIELDS_MISSING",
      "Executable stage envelope must define complete machine-readable task fields",
      {
        missingFields,
      }
    );
  }

  return validateExternalReadonlyAuthorization(envelope);
}

export function validateExternalReadonlyAuthorization(envelope) {
  const presentFields = EXTERNAL_READONLY_FIELDS.filter((field) => field in envelope);
  if (!("external_readonly_paths" in envelope)) {
    if (presentFields.length > 0) {
      throw new StageTaskError(
        "EXTERNAL_READONLY_FIELDS_UNEXPECTED",
        "External read-only fields require external_readonly_paths",
        { presentFields }
      );
    }
    return null;
  }

  const missingFields = EXTERNAL_READONLY_FIELDS.filter((field) => !(field in envelope));
  if (missingFields.length > 0) {
    throw new StageTaskError(
      "EXTERNAL_READONLY_FIELDS_INCOMPLETE",
      "External read-only authorization requires every companion field",
      { missingFields }
    );
  }

  const paths = envelope.external_readonly_paths;
  if (!Array.isArray(paths) || paths.length !== 1 || paths[0] !== LEGACY_READONLY_ROOT) {
    throw new StageTaskError(
      "EXTERNAL_READONLY_PATH_INVALID",
      "Protocol version 1 authorizes only the exact legacy project root",
      { paths }
    );
  }
  if (
    envelope.allowed_paths.some((path) =>
      allowedPathOverlapsLegacyReadonlyRoot(path)
    )
  ) {
    throw new StageTaskError(
      "EXTERNAL_READONLY_PATH_OVERLAPS_WRITE_SCOPE",
      "External read-only paths must not overlap allowed_paths",
      { allowedPaths: envelope.allowed_paths }
    );
  }
  if (envelope.external_readonly_purpose !== "legacy_inventory") {
    throw new StageTaskError(
      "EXTERNAL_READONLY_PURPOSE_INVALID",
      "External read-only purpose must equal legacy_inventory"
    );
  }
  if (envelope.external_readonly_owner_authorized !== true) {
    throw new StageTaskError(
      "EXTERNAL_READONLY_OWNER_AUTHORIZATION_REQUIRED",
      "External read-only access requires explicit owner authorization"
    );
  }

  const deniedPermissions = [
    "external_readonly_write_allowed",
    "external_readonly_execution_allowed",
    "external_readonly_network_allowed",
    "external_readonly_follow_symlinks",
    "external_readonly_sensitive_content_allowed",
  ].filter((field) => envelope[field] !== false);
  if (deniedPermissions.length > 0) {
    throw new StageTaskError(
      "EXTERNAL_READONLY_PERMISSION_INVALID",
      "External read-only authorization must deny write, execution, network, symlink, and sensitive-content access",
      { deniedPermissions }
    );
  }

  return Object.fromEntries(EXTERNAL_READONLY_FIELDS.map((field) => [field, envelope[field]]));
}

function pathsOverlap(left, right) {
  const normalizedLeft = lexicalPathComparisonKey(left);
  const normalizedRight = lexicalPathComparisonKey(right);
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.startsWith(`${normalizedRight}/`) ||
    normalizedRight.startsWith(`${normalizedLeft}/`)
  );
}

function lexicalPathComparisonKey(candidate) {
  return pathPosix
    .normalize(candidate)
    .normalize("NFC")
    .replace(/[A-Z]/g, (character) => character.toLowerCase());
}

function allowedPathOverlapsLegacyReadonlyRoot(candidate) {
  if (pathPosix.isAbsolute(candidate)) {
    return pathsOverlap(candidate, LEGACY_READONLY_ROOT);
  }

  const resolvedPath = pathPosix.resolve(FORMAL_REPOSITORY_ROOT, candidate);
  if (pathsOverlap(resolvedPath, LEGACY_READONLY_ROOT)) {
    return true;
  }

  if (!pathsOverlap(resolvedPath, FORMAL_REPOSITORY_ROOT)) {
    throw new StageTaskError(
      "RELATIVE_ALLOWED_PATH_ESCAPES_REPOSITORY",
      "Relative allowed_paths must remain within the formal repository root",
      { candidate, resolvedPath }
    );
  }

  return false;
}

export function buildNormalizedTask({
  issue,
  envelope,
  repositoryFullName,
  currentMainSha,
  localRepositoryPath,
  worktreeStatus = "",
  pullRequest = null,
}) {
  if (issue.state !== "open") {
    throw new StageTaskError("ISSUE_NOT_OPEN", "Stage issue must remain open", {
      issueNumber: issue.number,
      state: issue.state,
    });
  }

  if (envelope.status !== "READY_FOR_CODEX") {
    throw new StageTaskError("STATUS_NOT_READY", "Stage status must be READY_FOR_CODEX", {
      actualStatus: envelope.status,
    });
  }

  if (envelope.repository !== repositoryFullName) {
    throw new StageTaskError("REPOSITORY_MISMATCH", "Stage envelope targets a different repository", {
      expectedRepository: envelope.repository,
      actualRepository: repositoryFullName,
    });
  }

  if (envelope.expected_main_sha !== currentMainSha) {
    throw new StageTaskError("STALE_MAIN_SHA", "Current main SHA does not match the stage envelope", {
      expectedMainSha: envelope.expected_main_sha,
      actualMainSha: currentMainSha,
    });
  }

  if (worktreeStatus.trim().length > 0) {
    throw new StageTaskError("WORKTREE_NOT_CLEAN", "Worktree must be clean before starting a stage", {
      worktreeStatus,
    });
  }

  if (
    envelope.expected_issue_number !== undefined &&
    issue.number !== envelope.expected_issue_number
  ) {
    throw new StageTaskError("ISSUE_NUMBER_MISMATCH", "Stage issue number does not match the envelope", {
      expectedIssueNumber: envelope.expected_issue_number,
      actualIssueNumber: issue.number,
    });
  }

  if (envelope.expected_pr_number !== undefined) {
    if (!pullRequest) {
      throw new StageTaskError("EXPECTED_PR_MISSING", "Expected PR metadata was not provided");
    }
    if (pullRequest.number !== envelope.expected_pr_number) {
      throw new StageTaskError("EXPECTED_PR_NUMBER_MISMATCH", "Expected PR number does not match", {
        expectedPrNumber: envelope.expected_pr_number,
        actualPrNumber: pullRequest.number,
      });
    }
    if (
      envelope.expected_pr_state !== undefined &&
      pullRequest.state !== envelope.expected_pr_state
    ) {
      throw new StageTaskError("EXPECTED_PR_STATE_MISMATCH", "Expected PR state does not match", {
        expectedPrState: envelope.expected_pr_state,
        actualPrState: pullRequest.state,
      });
    }
    if (
      envelope.expected_pr_head_sha !== undefined &&
      pullRequest.head?.sha !== envelope.expected_pr_head_sha
    ) {
      throw new StageTaskError("EXPECTED_PR_HEAD_MISMATCH", "Expected PR head SHA does not match", {
        expectedPrHeadSha: envelope.expected_pr_head_sha,
        actualPrHeadSha: pullRequest.head?.sha,
      });
    }
    if (
      envelope.expected_pr_base_sha !== undefined &&
      pullRequest.base?.sha !== envelope.expected_pr_base_sha
    ) {
      throw new StageTaskError("EXPECTED_PR_BASE_MISMATCH", "Expected PR base SHA does not match", {
        expectedPrBaseSha: envelope.expected_pr_base_sha,
        actualPrBaseSha: pullRequest.base?.sha,
      });
    }
  }

  const externalReadonlyAuthorization = validateExecutableEnvelope(envelope);

  return {
    protocol_version: envelope.protocol_version,
    stage_id: envelope.stage_id,
    status: envelope.status,
    repository: envelope.repository,
    expected_main_sha: envelope.expected_main_sha,
    current_main_sha: currentMainSha,
    issue: {
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
      updated_at: issue.updated_at,
    },
    branch: envelope.branch,
    merge_method: envelope.merge_method,
    execution_mode: envelope.execution_mode,
    objective: envelope.objective,
    owner_merge_authorization_required: envelope.owner_merge_authorization_required,
    auto_merge_allowed: envelope.auto_merge_allowed,
    expected_issue_number: envelope.expected_issue_number ?? null,
    expected_pr_number: envelope.expected_pr_number ?? null,
    expected_pr_state: envelope.expected_pr_state ?? null,
    expected_pr_head_sha: envelope.expected_pr_head_sha ?? null,
    expected_pr_base_sha: envelope.expected_pr_base_sha ?? null,
    allowed_paths: envelope.allowed_paths,
    forbidden_paths: envelope.forbidden_paths,
    forbidden_actions: envelope.forbidden_actions,
    external_readonly: externalReadonlyAuthorization,
    acceptance_criteria: envelope.acceptance_criteria,
    required_validation_commands: envelope.required_validation_commands,
    local_repository_path: localRepositoryPath,
    worktree_clean: true,
    normalized_at: new Date().toISOString(),
  };
}

export function renderEnvelope(envelope, language) {
  if (language === "json") {
    return JSON.stringify(envelope, null, 2);
  }

  const orderedKeys = [
    "protocol_version",
    "stage_id",
    "status",
    "repository",
    "expected_main_sha",
    "execution_mode",
    "branch",
    "merge_method",
    "objective",
    "owner_merge_authorization_required",
    "auto_merge_allowed",
    "expected_issue_number",
    "expected_pr_number",
    "expected_pr_state",
    "expected_pr_head_sha",
    "expected_pr_base_sha",
    "external_readonly_paths",
    "external_readonly_purpose",
    "external_readonly_owner_authorized",
    "external_readonly_write_allowed",
    "external_readonly_execution_allowed",
    "external_readonly_network_allowed",
    "external_readonly_follow_symlinks",
    "external_readonly_sensitive_content_allowed",
    "allowed_paths",
    "forbidden_paths",
    "forbidden_actions",
    "acceptance_criteria",
    "required_validation_commands",
  ];

  const keys = [
    ...orderedKeys.filter((key) => key in envelope),
    ...Object.keys(envelope).filter((key) => !orderedKeys.includes(key)).sort(),
  ];

  return keys
    .map((key) => `${key}: ${renderYamlScalar(envelope[key])}`)
    .join("\n");
}

function renderYamlScalar(value) {
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return value;
}

export function replaceEnvelopeStatus(issueBody, nextStatus) {
  const envelopeMatch = extractEnvelope(issueBody);
  const envelope = parseEnvelopeContent(envelopeMatch.language, envelopeMatch.content);
  envelope.status = nextStatus;
  const rendered = renderEnvelope(envelope, envelopeMatch.language);
  return issueBody.replace(
    envelopeMatch.raw,
    `\`\`\`${envelopeMatch.language}\n${rendered}\n\`\`\``
  );
}

export function buildResultPayload({
  stageId,
  result,
  mainSha,
  branch,
  commitSha,
  prNumber = null,
  prUrl = null,
  prHeadSha = null,
  changedFiles,
  validation,
  worktreeClean,
  blockers,
  lockLifecycle,
  githubWrites,
  externalReadonlyAudit,
}) {
  if (!RESULT_VALUES.includes(result)) {
    throw new StageTaskError("RESULT_VALUE_INVALID", "Unsupported result value", {
      result,
    });
  }

  return {
    protocol_version: 1,
    stage_id: stageId,
    result,
    next_status: RESULT_TO_NEXT_STATUS[result],
    main_sha: mainSha,
    branch,
    commit_sha: commitSha,
    pr_number: prNumber,
    pr_url: prUrl,
    exact_pr_head_sha: prHeadSha,
    changed_files: changedFiles,
    validation,
    worktree_clean: worktreeClean,
    blockers,
    lock_lifecycle: lockLifecycle,
    github_writes: githubWrites,
    ...(externalReadonlyAudit !== undefined
      ? { external_readonly_audit: externalReadonlyAudit }
      : {}),
    reported_at: new Date().toISOString(),
  };
}

export function buildResultComment(resultPayload) {
  return [
    `<!-- codex-stage-result:${resultPayload.stage_id} -->`,
    "```json",
    JSON.stringify(resultPayload, null, 2),
    "```",
  ].join("\n");
}

export function findManagedResultComments(comments, stageId) {
  const marker = `<!-- codex-stage-result:${stageId} -->`;
  return comments.filter((comment) => (comment.body || "").includes(marker));
}

export function labelsForStatus(status) {
  const routing = {
    READY_FOR_CODEX: ["codex:ready"],
    CODEX_RUNNING: ["codex:running"],
    BLOCKED: ["codex:blocked"],
    READY_FOR_CHATGPT_REVIEW: ["chatgpt:review"],
    CHANGES_REQUESTED: ["chatgpt:review"],
    READY_FOR_MERGE: ["owner:merge"],
    MERGED: ["stage:done"],
    CANCELLED: [],
  };
  if (!Object.hasOwn(routing, status)) {
    throw new StageTaskError("STAGE_STATUS_UNSUPPORTED", "No routing label mapping exists for status", {
      status,
    });
  }
  return routing[status];
}

function validateSha(value, fieldName, { nullable = false } = {}) {
  if (nullable && value === null) {
    return;
  }
  if (typeof value !== "string" || !SHA1_PATTERN.test(value)) {
    throw new StageTaskError("RESULT_SCHEMA_INVALID", `${fieldName} must be a 40-character SHA`, {
      field: fieldName,
      value,
    });
  }
}

function validateNullableString(value, fieldName) {
  if (value === null) {
    return;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new StageTaskError("RESULT_SCHEMA_INVALID", `${fieldName} must be a non-empty string or null`, {
      field: fieldName,
      value,
    });
  }
}

function validateStringArray(value, fieldName, { minItems = 0 } = {}) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new StageTaskError("RESULT_SCHEMA_INVALID", `${fieldName} must be an array of non-empty strings`, {
      field: fieldName,
      value,
    });
  }
  if (value.length < minItems) {
    throw new StageTaskError("RESULT_SCHEMA_INVALID", `${fieldName} must contain at least ${minItems} item(s)`, {
      field: fieldName,
      value,
    });
  }
}

function normalizeValidationEntry(entry, index) {
  const allowedKeys = new Set(["command", "ok", "notes"]);
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new StageTaskError("RESULT_SCHEMA_INVALID", "validation entries must be objects", {
      index,
      entry,
    });
  }
  for (const key of Object.keys(entry)) {
    if (!allowedKeys.has(key)) {
      throw new StageTaskError("RESULT_SCHEMA_INVALID", "validation entry contains an unexpected key", {
        index,
        key,
      });
    }
  }
  if (typeof entry.command !== "string" || entry.command.trim().length === 0) {
    throw new StageTaskError("RESULT_SCHEMA_INVALID", "validation command must be a non-empty string", {
      index,
      entry,
    });
  }
  if (typeof entry.ok !== "boolean") {
    throw new StageTaskError("RESULT_SCHEMA_INVALID", "validation ok must be boolean", {
      index,
      entry,
    });
  }
  if (entry.notes !== undefined) {
    validateStringArray(entry.notes, "validation.notes");
  }
  return {
    command: entry.command,
    ok: entry.ok,
    ...(entry.notes ? { notes: entry.notes } : {}),
  };
}

function normalizeLockLifecycle(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StageTaskError("RESULT_SCHEMA_INVALID", "lock_lifecycle must be an object", {
      field: "lock_lifecycle",
      value,
    });
  }
  const allowedKeys = new Set(["acquired", "release_timing", "release_expected"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new StageTaskError("RESULT_SCHEMA_INVALID", "lock_lifecycle contains an unexpected key", {
        field: "lock_lifecycle",
        key,
      });
    }
  }
  for (const key of allowedKeys) {
    if (!(key in value)) {
      throw new StageTaskError("RESULT_SCHEMA_INVALID", `lock_lifecycle.${key} is required`, {
        field: "lock_lifecycle",
        key,
      });
    }
  }
  if (value.acquired !== true) {
    throw new StageTaskError("RESULT_SCHEMA_INVALID", "lock_lifecycle.acquired must be true", {
      field: "lock_lifecycle.acquired",
      value,
    });
  }
  if (value.release_timing !== "after_final_reporting") {
    throw new StageTaskError(
      "RESULT_SCHEMA_INVALID",
      "lock_lifecycle.release_timing must equal after_final_reporting",
      {
        field: "lock_lifecycle.release_timing",
        value,
      }
    );
  }
  if (value.release_expected !== true) {
    throw new StageTaskError("RESULT_SCHEMA_INVALID", "lock_lifecycle.release_expected must be true", {
      field: "lock_lifecycle.release_expected",
      value,
    });
  }
  return {
    acquired: true,
    release_timing: "after_final_reporting",
    release_expected: true,
  };
}

export function normalizeResultPayload(resultPayload, { externalReadonlyAuthorization = null } = {}) {
  const allowedKeys = new Set([
    "protocol_version",
    "stage_id",
    "result",
    "next_status",
    "main_sha",
    "branch",
    "commit_sha",
    "pr_number",
    "pr_url",
    "exact_pr_head_sha",
    "changed_files",
    "validation",
    "worktree_clean",
    "blockers",
    "lock_lifecycle",
    "github_writes",
    "external_readonly_audit",
    "reported_at",
  ]);

  if (!resultPayload || typeof resultPayload !== "object" || Array.isArray(resultPayload)) {
    throw new StageTaskError("RESULT_SCHEMA_INVALID", "Result payload must be an object");
  }

  for (const key of Object.keys(resultPayload)) {
    if (!allowedKeys.has(key)) {
      throw new StageTaskError("RESULT_SCHEMA_INVALID", "Result payload contains an unexpected key", {
        key,
      });
    }
  }

  if (resultPayload.protocol_version !== 1) {
    throw new StageTaskError("RESULT_SCHEMA_INVALID", "protocol_version must equal 1");
  }
  if (typeof resultPayload.stage_id !== "string" || !/^[A-Z0-9][A-Z0-9_-]*$/.test(resultPayload.stage_id)) {
    throw new StageTaskError("RESULT_SCHEMA_INVALID", "stage_id must match the stage identifier pattern", {
      stage_id: resultPayload.stage_id,
    });
  }
  if (!RESULT_VALUES.includes(resultPayload.result)) {
    throw new StageTaskError("RESULT_INVALID", "Unsupported stage result", {
      result: resultPayload.result,
    });
  }

  const nextStatus = RESULT_TO_NEXT_STATUS[resultPayload.result];
  if (
    resultPayload.next_status !== undefined &&
    resultPayload.next_status !== nextStatus
  ) {
    throw new StageTaskError(
      "RESULT_NEXT_STATUS_MISMATCH",
      "next_status must match the derived result transition",
      {
        result: resultPayload.result,
        expectedNextStatus: nextStatus,
        actualNextStatus: resultPayload.next_status,
      }
    );
  }

  validateSha(resultPayload.main_sha, "main_sha");
  validateSha(resultPayload.commit_sha, "commit_sha");
  if (typeof resultPayload.branch !== "string" || resultPayload.branch.trim().length === 0) {
    throw new StageTaskError("RESULT_SCHEMA_INVALID", "branch must be a non-empty string", {
      branch: resultPayload.branch,
    });
  }

  if (resultPayload.pr_number !== null && resultPayload.pr_number !== undefined) {
    if (!Number.isInteger(resultPayload.pr_number) || resultPayload.pr_number <= 0) {
      throw new StageTaskError("RESULT_SCHEMA_INVALID", "pr_number must be a positive integer or null", {
        pr_number: resultPayload.pr_number,
      });
    }
  }
  validateNullableString(resultPayload.pr_url ?? null, "pr_url");
  validateSha(resultPayload.exact_pr_head_sha ?? null, "exact_pr_head_sha", {
    nullable: true,
  });

  validateStringArray(resultPayload.changed_files, "changed_files");
  if (!Array.isArray(resultPayload.validation)) {
    throw new StageTaskError("RESULT_SCHEMA_INVALID", "validation must be an array", {
      validation: resultPayload.validation,
    });
  }
  if (typeof resultPayload.worktree_clean !== "boolean") {
    throw new StageTaskError("RESULT_SCHEMA_INVALID", "worktree_clean must be boolean");
  }
  validateStringArray(resultPayload.blockers, "blockers", {
    minItems: resultPayload.result === "BLOCKED" ? 1 : 0,
  });
  if (resultPayload.result === "PR_CREATED_FOR_REVIEW" && resultPayload.blockers.length !== 0) {
    throw new StageTaskError(
      "RESULT_SCHEMA_INVALID",
      "PR_CREATED_FOR_REVIEW requires an empty blockers array",
      {
        blockers: resultPayload.blockers,
      }
    );
  }
  validateStringArray(resultPayload.github_writes, "github_writes");
  const externalReadonlyAudit = normalizeExternalReadonlyAudit(
    resultPayload.external_readonly_audit,
    externalReadonlyAuthorization
  );

  return {
    protocol_version: 1,
    stage_id: resultPayload.stage_id,
    result: resultPayload.result,
    next_status: nextStatus,
    main_sha: resultPayload.main_sha,
    branch: resultPayload.branch,
    commit_sha: resultPayload.commit_sha,
    pr_number: resultPayload.pr_number ?? null,
    pr_url: resultPayload.pr_url ?? null,
    exact_pr_head_sha: resultPayload.exact_pr_head_sha ?? null,
    changed_files: resultPayload.changed_files,
    validation: resultPayload.validation.map((entry, index) =>
      normalizeValidationEntry(entry, index)
    ),
    worktree_clean: resultPayload.worktree_clean,
    blockers: resultPayload.blockers,
    lock_lifecycle: normalizeLockLifecycle(resultPayload.lock_lifecycle),
    github_writes: resultPayload.github_writes,
    ...(externalReadonlyAudit ? { external_readonly_audit: externalReadonlyAudit } : {}),
    reported_at:
      typeof resultPayload.reported_at === "string" &&
      resultPayload.reported_at.trim().length > 0
        ? resultPayload.reported_at
        : new Date().toISOString(),
  };
}

function normalizeExternalReadonlyAudit(value, authorization) {
  if (!authorization) {
    if (value !== undefined) {
      throw new StageTaskError(
        "RESULT_SCHEMA_INVALID",
        "external_readonly_audit is allowed only for an externally authorized stage"
      );
    }
    return null;
  }
  const requiredKeys = [
    "authorized_paths",
    "access_occurred",
    "writes_attempted",
    "execution_attempted",
    "network_accessed",
    "symlinks_followed",
    "sensitive_content_read",
    "scratch_cleanup_completed",
    "entries_inspected",
  ];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StageTaskError("RESULT_SCHEMA_INVALID", "external_readonly_audit is required");
  }
  for (const key of Object.keys(value)) {
    if (!requiredKeys.includes(key)) {
      throw new StageTaskError("RESULT_SCHEMA_INVALID", "external_readonly_audit contains an unexpected key", { key });
    }
  }
  for (const key of requiredKeys) {
    if (!(key in value)) {
      throw new StageTaskError("RESULT_SCHEMA_INVALID", `external_readonly_audit.${key} is required`, { key });
    }
  }
  if (
    !Array.isArray(value.authorized_paths) ||
    value.authorized_paths.length !== 1 ||
    value.authorized_paths[0] !== LEGACY_READONLY_ROOT
  ) {
    throw new StageTaskError("RESULT_SCHEMA_INVALID", "external_readonly_audit.authorized_paths must equal the authorized root");
  }
  for (const key of requiredKeys.slice(1, -1)) {
    if (typeof value[key] !== "boolean") {
      throw new StageTaskError("RESULT_SCHEMA_INVALID", `external_readonly_audit.${key} must be boolean`, { key });
    }
  }
  if (!Number.isInteger(value.entries_inspected) || value.entries_inspected < 0) {
    throw new StageTaskError("RESULT_SCHEMA_INVALID", "external_readonly_audit.entries_inspected must be a non-negative integer");
  }
  for (const key of [
    "writes_attempted",
    "execution_attempted",
    "network_accessed",
    "symlinks_followed",
    "sensitive_content_read",
  ]) {
    if (value[key] !== false) {
      throw new StageTaskError("RESULT_SCHEMA_INVALID", `external_readonly_audit.${key} must be false`, { key });
    }
  }
  if (value.scratch_cleanup_completed !== true) {
    throw new StageTaskError("RESULT_SCHEMA_INVALID", "external_readonly_audit.scratch_cleanup_completed must be true");
  }
  if (!value.access_occurred && value.entries_inspected !== 0) {
    throw new StageTaskError("RESULT_SCHEMA_INVALID", "external_readonly_audit without access must inspect zero entries");
  }
  return { ...value };
}

export async function runCommand(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env || {}) },
    maxBuffer: 10 * 1024 * 1024,
  });
  return result.stdout;
}

export async function gitRemoteRepository(cwd) {
  const remote = (await runCommand("git", ["remote", "get-url", "origin"], { cwd })).trim();
  return normalizeRepositoryRemote(remote);
}

export async function gitCurrentHead(cwd) {
  return (await runCommand("git", ["rev-parse", "HEAD"], { cwd })).trim();
}

export async function gitStatusShort(cwd) {
  return (await runCommand("git", ["status", "--short"], { cwd })).trim();
}
