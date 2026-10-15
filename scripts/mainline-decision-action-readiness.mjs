#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));

const action = process.env.MAINLINE_DECISION_ACTION ?? "request_decision";
const authorization = process.env.MAINLINE_DECISION_ACTION_AUTHORIZATION ?? "";
const allowedActions = new Set(["request_decision", "go_promote_candidate", "no_go_archive_candidate"]);
const expectedAuthorization = {
  request_decision: "",
  go_promote_candidate: "授权执行候选主线 Go 升级准备",
  no_go_archive_candidate: "授权执行候选主线 No-Go 归档准备"
};

const checks = [];
const blockers = [];
const warnings = [];

check("action is supported", allowedActions.has(action), {
  action,
  allowed: [...allowedActions]
});

const packageJson = readJson("package.json");
const makefile = read("Makefile");
const status = read("STATUS.md");
const decisionDoc = read("docs/audit/candidate-mainline-decision.md");
const project = read("PROJECT.md");
const projectIsCandidate = project.includes("不是已经接管生产写入的正式主仓");
const projectIsOfficialMainline = project.includes("正式工程主线");

check("package exposes mainline decision readiness", Boolean(packageJson.scripts?.["mainline-decision-readiness"]), "package.json");
check("make exposes mainline decision readiness", /mainline-decision-readiness:/.test(makefile), "Makefile");
check("candidate final decision package exists", existsSync(join(root, "docs/audit/candidate-mainline-decision.md")), "docs/audit/candidate-mainline-decision.md");
check("decision package says final review may start", decisionDoc.includes("可以进入候选主线最终决策评审"), "docs/audit/candidate-mainline-decision.md");
check("decision package does not auto-promote", decisionDoc.includes("暂不升级为唯一正式主仓"), "docs/audit/candidate-mainline-decision.md");
check("decision package lists Go action", decisionDoc.includes("候选仓升级为正式主仓"), "docs/audit/candidate-mainline-decision.md");
check("decision package lists No-Go action", decisionDoc.includes("候选基线停止扩张并归档"), "docs/audit/candidate-mainline-decision.md");
check("status records readiness passed", status.includes("mainline-decision-readiness") && status.includes("goNoGo=mainline_decision_readiness_ready"), "STATUS.md");
check("status keeps candidate write token disabled", !status.includes("candidate_write_token_enabled=true"), "STATUS.md");
check("status keeps legacy API proxy unswitched", !status.includes("legacy_api_proxy_switched=true"), "STATUS.md");
check("project status is candidate before Go or official after Go", projectIsCandidate || projectIsOfficialMainline, "PROJECT.md");

const readiness = await runJson("node", ["scripts/mainline-decision-readiness.mjs"], {});
check("mainline decision readiness dry-run passes", readiness.output?.ok === true, summarizeRun(readiness));

if (action === "request_decision") {
  warnings.push({
    id: "decision-required",
    reason: "This action only prepares the final decision request; it does not promote or archive."
  });
} else if (allowedActions.has(action)) {
  check("explicit action authorization", authorization === expectedAuthorization[action], {
    action,
    expectedAuthorization: expectedAuthorization[action],
    provided: authorization.length > 0,
    valuePrinted: false
  });
  if (action === "go_promote_candidate") {
    check(
      "go action requires old production fact boundary to remain explicit",
      status.includes("旧系统仍按审计原则视为真实成交、真实持仓、复盘的唯一生产事实源")
        || status.includes("真实成交、真实持仓和复盘仍由旧系统保护"),
      "STATUS.md"
    );
    check("go action requires no long-lived candidate token", status.includes("未启用候选写 token"), "STATUS.md");
  }
  if (action === "no_go_archive_candidate") {
    check("no-go action keeps reusable work listed", decisionDoc.includes("把可复用测试、contract、migration 和受限路由设计回迁老仓"), "docs/audit/candidate-mainline-decision.md");
  }
}

const result = {
  ok: blockers.length === 0,
  checkedAt: new Date().toISOString(),
  action,
  mode: {
    readOnly: true,
    deploysNginx: false,
    reloadsServices: false,
    writesProductionFacts: false,
    enablesCandidateWriteToken: false,
    switchesLegacyApiProxy: false,
    changesProjectStatus: false,
    archivesLegacySystem: false
  },
  decisionRequired: action === "request_decision",
  actionPlan: buildActionPlan(action),
  checks,
  blockers,
  warnings,
  runs: {
    mainlineDecisionReadiness: summarizeRun(readiness)
  },
  goNoGo: blockers.length === 0
    ? goNoGoFor(action)
    : "no_go_clear_mainline_decision_action_blockers",
  notes: [
    "This gate prepares the final mainline decision action; it does not execute promotion, archival, deployment, token changes, or production writes.",
    "A Go action still requires a separate implementation commit to update PROJECT/STATUS and archive or freeze old-system development.",
    "A No-Go action still requires a separate implementation commit to mark the candidate archived and list reusable work to migrate back.",
    "Physical iPhone remains deferred unless explicitly brought online and verified."
  ]
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}

function buildActionPlan(selectedAction) {
  if (selectedAction === "go_promote_candidate") {
    return [
      "Create a promotion commit that updates PROJECT.md from candidate baseline to official main repository.",
      "Update STATUS.md to mark the candidate as the official engineering mainline while preserving old trades/positions/reviews boundaries.",
      "Mark old system and FastAPI reference line as no-new-feature/read-only archive except explicitly retained production fact boundaries.",
      "Keep long-lived candidate write token disabled until a separate bounded write authorization exists.",
      "Run mainline-decision-readiness, contract tests, unit tests, and production observation after the promotion commit."
    ];
  }
  if (selectedAction === "no_go_archive_candidate") {
    return [
      "Create an archive commit that marks the candidate line stopped.",
      "List reusable tests, contracts, migrations, and route designs for old-system backport.",
      "Keep old system as the production fact source.",
      "Do not create a new parallel candidate for the same reason.",
      "Run mainline-decision-readiness to prove no production boundary changed during archival planning."
    ];
  }
  return [
    "Present the final Go/No-Go choice to the user.",
    "Require one explicit action authorization before promotion or archival preparation.",
    "Do not change PROJECT.md official status, deploy, archive, or enable tokens in request mode.",
    "Keep the current bounded route and observation gates active."
  ];
}

function goNoGoFor(selectedAction) {
  if (selectedAction === "go_promote_candidate") return "mainline_go_promotion_action_ready";
  if (selectedAction === "no_go_archive_candidate") return "mainline_no_go_archive_action_ready";
  return "mainline_decision_action_ready_to_request_user_choice";
}

function check(id, ok, evidence = {}) {
  const item = { id, ok, evidence };
  checks.push(item);
  if (!ok) {
    blockers.push({ id, evidence });
  }
}

async function runJson(command, args, envOverrides) {
  const run = await runCommand(command, args, envOverrides);
  return {
    ...run,
    output: parseJsonOutput(run.stdout)
  };
}

async function runCommand(command, args, envOverrides = {}) {
  try {
    const result = await execFileAsync(command, args, {
      env: {
        ...process.env,
        ...envOverrides
      },
      maxBuffer: 20 * 1024 * 1024
    });
    return {
      ok: true,
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
      stdoutPreview: sanitize(result.stdout),
      stderrPreview: sanitize(result.stderr)
    };
  } catch (error) {
    return {
      ok: false,
      exitCode: error.code ?? null,
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? ""),
      stdoutPreview: sanitize(error.stdout),
      stderrPreview: sanitize(error.stderr),
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function summarizeRun(run) {
  if (!run) return null;
  return {
    ok: run.output?.ok === true || run.exitCode === 0,
    exitCode: run.exitCode,
    goNoGo: run.output?.goNoGo ?? null,
    stdoutPreview: run.stdoutPreview || undefined,
    stderrPreview: run.stderrPreview || undefined
  };
}

function parseJsonOutput(text) {
  const trimmed = String(text ?? "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function sanitize(value) {
  return String(value ?? "")
    .replace(/(TOKEN|PASSWORD|DATABASE_URL)=([^\s]+)/gi, "$1=<redacted>")
    .slice(0, 1400);
}
