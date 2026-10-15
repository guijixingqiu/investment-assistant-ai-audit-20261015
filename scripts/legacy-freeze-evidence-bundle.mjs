#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = process.env.LEGACY_FREEZE_EVIDENCE_OUTPUT ?? "artifacts/legacy-freeze/evidence-bundle.json";
const strict = process.env.LEGACY_FREEZE_EVIDENCE_STRICT === "1";

const commandSpecs = [
  {
    id: "legacy-freeze-rules-check",
    script: "scripts/legacy-freeze-rules-check.mjs",
    env: { LEGACY_FREEZE_WRITE_OUTPUT: "0" },
    summarize: (json) => ({
      ok: json?.ok === true,
      ruleCount: json?.ruleCount ?? null,
      allowedExampleCount: json?.allowedExampleCount ?? null,
      blockerCount: json?.blockers?.length ?? null
    })
  },
  {
    id: "production-takeover-boundary-check",
    script: "scripts/production-takeover-boundary-check.mjs",
    summarize: (json) => ({
      ok: json?.ok === true,
      routeCount: json?.routes?.length ?? null,
      allowedWriteCount: json?.productionTakeoverScope?.allowedWrites?.length ?? null,
      outOfScopeWrites: json?.productionTakeoverScope?.explicitlyOutOfScopeWrites ?? []
    })
  },
  {
    id: "legacy-freeze-readiness",
    script: "scripts/legacy-freeze-readiness.mjs",
    env: strict ? { LEGACY_FREEZE_REQUIRE_PRODUCTION_ENV: "1" } : { LEGACY_FREEZE_REQUIRE_PRODUCTION_ENV: "0" },
    summarize: (json) => ({
      ok: json?.ok === true,
      blockerCount: json?.blockers?.length ?? null,
      warningIds: (json?.warnings ?? []).map((item) => item.id),
      productionEnvRequired: json?.mode?.requireProductionEnv === true
    })
  },
  {
    id: "legacy-freeze-preflight",
    script: "scripts/legacy-freeze-preflight.mjs",
    env: strict
      ? {
          LEGACY_FREEZE_PREFLIGHT_REQUIRE_PRODUCTION_ENV: "1",
          LEGACY_FREEZE_REQUIRE_PRODUCTION_ENV: "1",
          LEGACY_FREEZE_PREFLIGHT_REQUIRE_CLEAN_GIT: "1"
        }
      : { LEGACY_FREEZE_PREFLIGHT_REQUIRE_PRODUCTION_ENV: "0", LEGACY_FREEZE_REQUIRE_PRODUCTION_ENV: "0" },
    summarize: (json) => ({
      ok: json?.ok === true,
      blockerCount: json?.blockers?.length ?? null,
      warningIds: (json?.warnings ?? []).map((item) => item.id),
      goNoGo: json?.goNoGo ?? null,
      ruleCount: json?.summary?.ruleCount ?? null,
      requireProductionEnv: json?.mode?.requireProductionEnv === true,
      requireCleanGit: json?.mode?.requireCleanGit === true,
      worktreeClean: json?.repository?.worktreeClean === true
    })
  },
  {
    id: "legacy-freeze-post-smoke-check",
    script: "scripts/legacy-freeze-post-apply-smoke-check.mjs",
    summarize: (json) => ({
      ok: json?.ok === true,
      blockerCount: json?.blockers?.length ?? null,
      frozenExamples: json?.summary?.frozenExamples ?? null,
      allowedExamples: json?.summary?.allowedExamples ?? null,
      candidateUnaffectedExamples: json?.summary?.candidateUnaffectedExamples ?? null,
      goNoGo: json?.goNoGo ?? null
    })
  },
  {
    id: "legacy-freeze-live-smoke-dry-run",
    script: "scripts/legacy-freeze-live-smoke.mjs",
    env: { LEGACY_FREEZE_LIVE_SMOKE: "0" },
    summarize: (json) => ({
      ok: json?.ok === true,
      dryRun: json?.mode?.dryRun === true,
      live: json?.mode?.live === true,
      sentHttp: json?.liveResult !== null,
      goNoGo: json?.goNoGo ?? null,
      secretValuesPrinted: json?.dryRunPlan?.secretValuesPrinted === true,
      requestBodiesPrinted: json?.dryRunPlan?.requestBodiesPrinted === true
    })
  }
];

const git = await readGitState();
const commands = [];
for (const spec of commandSpecs) {
  commands.push(await runEvidenceCommand(spec));
}

const commandOk = commands.every((item) => item.ok);
const worktreeClean = git.statusShort.length === 0;
const ok = commandOk && worktreeClean;

const bundle = {
  schemaVersion: "2026-06-18.legacy-freeze-evidence.v1",
  ok,
  checkedAt: new Date().toISOString(),
  mode: {
    strict
  },
  repository: {
    root,
    branch: git.branch,
    head: git.head,
    worktreeClean,
    statusShort: git.statusShort
  },
  commands,
  productionEnv: summarizeEnv(),
  artifact: {
    path: outputPath,
    secretValuesPrinted: false,
    requestBodiesPrinted: false
  },
  goNoGo: ok
    ? "freeze_window_evidence_bundle_ready"
    : "no_go_clear_evidence_bundle_blockers",
  notes: [
    "This bundle is generated locally and is safe to commit only if it contains no secrets.",
    "It does not deploy nginx, reload services, freeze legacy endpoints, send production HTTP requests, or write production databases.",
    "The live smoke command is executed in dry-run mode only.",
    strict
      ? "Strict production env checks were requested for this bundle."
      : "Strict production env checks must still be rerun immediately before a real freeze window."
  ]
};

mkdirSync(dirname(join(root, outputPath)), { recursive: true });
writeFileSync(join(root, outputPath), `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
console.log(JSON.stringify(bundle, null, 2));

if (!bundle.ok) {
  process.exit(1);
}

async function runEvidenceCommand(spec) {
  const result = await runNodeJson(spec.script, spec.env ?? {});
  const summary = spec.summarize(result.output);
  return {
    id: spec.id,
    ok: result.exitCode === 0 && summary.ok === true,
    exitCode: result.exitCode,
    summary,
    stdoutParsed: Boolean(result.output),
    stderrPreview: sanitize(result.stderr),
    secretValuesPrinted: false
  };
}

async function runNodeJson(script, extraEnv) {
  try {
    const result = await execFileAsync(process.execPath, [script], {
      cwd: root,
      env: { ...process.env, ...extraEnv },
      maxBuffer: 20 * 1024 * 1024
    });
    return {
      exitCode: 0,
      output: parseJson(result.stdout),
      stderr: result.stderr
    };
  } catch (error) {
    return {
      exitCode: error.code ?? 1,
      output: parseJson(String(error.stdout ?? "")),
      stderr: String(error.stderr ?? error.message ?? "")
    };
  }
}

async function readGitState() {
  const [branch, head, status] = await Promise.all([
    execGit(["branch", "--show-current"]),
    execGit(["rev-parse", "--short", "HEAD"]),
    execGit(["status", "--short"])
  ]);
  return {
    branch: branch.trim(),
    head: head.trim(),
    statusShort: status.split("\n").map((line) => line.trimEnd()).filter(Boolean)
  };
}

async function execGit(args) {
  const result = await execFileAsync("git", args, { cwd: root, maxBuffer: 1024 * 1024 });
  return result.stdout;
}

function summarizeEnv() {
  const names = [
    "CANDIDATE_PRODUCTION_BASE_URL",
    "STAGING_WRITE_BASE_URL",
    "STAGING_WRITE_TOKEN",
    "STAGING_DATABASE_URL",
    "DATA_GATE_SAMPLE_PATH",
    "LEGACY_FREEZE_BACKUP_SHA256",
    "LEGACY_FREEZE_NGINX_BACKUP_PATH",
    "LEGACY_FREEZE_NGINX_BACKUP_SHA256",
    "LEGACY_FREEZE_LIVE_AUTHORIZATION",
    "LEGACY_FREEZE_LIVE_SMOKE"
  ];
  return Object.fromEntries(names.map((name) => [
    name,
    {
      present: Boolean(process.env[name]),
      valuePrinted: false
    }
  ]));
}

function parseJson(text) {
  const value = String(text ?? "").trim();
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(value.slice(start, end + 1));
  } catch {
    return null;
  }
}

function sanitize(value) {
  return String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer <redacted>")
    .replace(/postgres(?:ql)?:\/\/[^\s"]+/gi, "postgres://<redacted>")
    .replace(/token["'=:\s]+[A-Za-z0-9._-]+/gi, "token=<redacted>")
    .slice(0, 1000);
}
