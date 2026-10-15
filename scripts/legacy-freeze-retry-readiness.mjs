#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));

const requireCleanGit = process.env.LEGACY_FREEZE_RETRY_REQUIRE_CLEAN_GIT === "1";
const runStrictEvidence = process.env.LEGACY_FREEZE_RETRY_RUN_STRICT_EVIDENCE === "1";
const expectedAuthorization = "授权进入旧系统研究/证据/决策检查写入口冻结窗口";

const checks = [];
const blockers = [];
const warnings = [];

const env = envSummary();

check("candidate production base URL includes /candidate-api", includesCandidatePrefix(process.env.CANDIDATE_PRODUCTION_BASE_URL), {
  present: env.CANDIDATE_PRODUCTION_BASE_URL.present,
  valuePrinted: false
});
check("staging write base URL includes /candidate-api", includesCandidatePrefix(process.env.STAGING_WRITE_BASE_URL), {
  present: env.STAGING_WRITE_BASE_URL.present,
  valuePrinted: false
});
check("staging write token provided", Boolean(process.env.STAGING_WRITE_TOKEN), {
  present: env.STAGING_WRITE_TOKEN.present,
  valuePrinted: false
});
check("staging database URL provided", Boolean(process.env.STAGING_DATABASE_URL), {
  present: env.STAGING_DATABASE_URL.present,
  valuePrinted: false
});
check("latest data gate sample exists", envPathExists("DATA_GATE_SAMPLE_PATH"), {
  present: env.DATA_GATE_SAMPLE_PATH.present,
  valuePrinted: false
});
check("legacy DB backup exists", envPathExists("LEGACY_FREEZE_BACKUP_PATH"), {
  present: env.LEGACY_FREEZE_BACKUP_PATH.present,
  valuePrinted: false
});
check("legacy DB backup sha256 matches", envShaMatches("LEGACY_FREEZE_BACKUP_PATH", "LEGACY_FREEZE_BACKUP_SHA256"), {
  pathPresent: env.LEGACY_FREEZE_BACKUP_PATH.present,
  shaPresent: env.LEGACY_FREEZE_BACKUP_SHA256.present,
  valuePrinted: false
});
check("nginx backup exists", envPathExists("LEGACY_FREEZE_NGINX_BACKUP_PATH"), {
  present: env.LEGACY_FREEZE_NGINX_BACKUP_PATH.present,
  valuePrinted: false
});
check("nginx backup sha256 matches", envShaMatches("LEGACY_FREEZE_NGINX_BACKUP_PATH", "LEGACY_FREEZE_NGINX_BACKUP_SHA256"), {
  pathPresent: env.LEGACY_FREEZE_NGINX_BACKUP_PATH.present,
  shaPresent: env.LEGACY_FREEZE_NGINX_BACKUP_SHA256.present,
  valuePrinted: false
});
check("legacy freeze authorization phrase provided", process.env.LEGACY_FREEZE_LIVE_AUTHORIZATION === expectedAuthorization, {
  present: env.LEGACY_FREEZE_LIVE_AUTHORIZATION.present,
  valuePrinted: false
});
check("legacy base URL excludes /candidate-api", isHttpUrl(process.env.LEGACY_FREEZE_LEGACY_BASE_URL) && !String(process.env.LEGACY_FREEZE_LEGACY_BASE_URL).includes("/candidate-api"), {
  present: env.LEGACY_FREEZE_LEGACY_BASE_URL.present,
  valuePrinted: false
});
check("freeze candidate base URL includes /candidate-api", isHttpUrl(process.env.LEGACY_FREEZE_CANDIDATE_BASE_URL) && includesCandidatePrefix(process.env.LEGACY_FREEZE_CANDIDATE_BASE_URL), {
  present: env.LEGACY_FREEZE_CANDIDATE_BASE_URL.present,
  valuePrinted: false
});

const postRecovery = await runStep(
  "candidate-production-post-recovery-verify",
  commandSpec("LEGACY_FREEZE_RETRY_POST_RECOVERY_COMMAND", {
    command: process.execPath,
    args: ["scripts/candidate-production-post-recovery-verify.mjs"]
  }),
  buildPostRecoveryEnv()
);
check("candidate post-recovery production/iOS smoke passed", postRecovery.ok && postRecovery.json?.ok === true, {
  goNoGo: postRecovery.json?.goNoGo ?? null,
  error: postRecovery.error,
  stderrPreview: postRecovery.stderrPreview
});

const tokenReadiness = await runStep(
  "staging-write-token-readiness",
  commandSpec("LEGACY_FREEZE_RETRY_TOKEN_READINESS_COMMAND", {
    command: process.execPath,
    args: ["scripts/staging-write-token-readiness.mjs"]
  }),
  process.env
);
check("staging write token lifecycle readiness passed", tokenReadiness.ok && tokenReadiness.json?.ok === true, {
  goNoGo: tokenReadiness.json?.goNoGo ?? null,
  error: tokenReadiness.error,
  stderrPreview: tokenReadiness.stderrPreview
});

const strictPreflight = await runStep(
  "legacy-freeze-preflight-strict",
  commandSpec("LEGACY_FREEZE_RETRY_PREFLIGHT_COMMAND", {
    command: process.execPath,
    args: ["scripts/legacy-freeze-preflight.mjs"]
  }),
  {
    ...process.env,
    LEGACY_FREEZE_PREFLIGHT_REQUIRE_PRODUCTION_ENV: "1",
    LEGACY_FREEZE_REQUIRE_PRODUCTION_ENV: "1",
    LEGACY_FREEZE_PREFLIGHT_REQUIRE_CLEAN_GIT: requireCleanGit ? "1" : "0"
  }
);
check("legacy freeze strict preflight passed", strictPreflight.ok && strictPreflight.json?.ok === true, {
  goNoGo: strictPreflight.json?.goNoGo ?? null,
  requireCleanGit,
  error: strictPreflight.error,
  stderrPreview: strictPreflight.stderrPreview
});

let strictEvidence = null;
if (runStrictEvidence) {
  strictEvidence = await runStep(
    "legacy-freeze-evidence-bundle-strict",
    commandSpec("LEGACY_FREEZE_RETRY_EVIDENCE_COMMAND", {
      command: process.execPath,
      args: ["scripts/legacy-freeze-evidence-bundle.mjs"]
    }),
    {
      ...process.env,
      LEGACY_FREEZE_EVIDENCE_STRICT: "1",
      LEGACY_FREEZE_PREFLIGHT_REQUIRE_CLEAN_GIT: requireCleanGit ? "1" : "0"
    }
  );
  check("legacy freeze strict evidence bundle passed", strictEvidence.ok && strictEvidence.json?.ok === true, {
    goNoGo: strictEvidence.json?.goNoGo ?? null,
    error: strictEvidence.error,
    stderrPreview: strictEvidence.stderrPreview
  });
} else {
  warnings.push({
    id: "strict-evidence-not-run",
    reason: "LEGACY_FREEZE_RETRY_RUN_STRICT_EVIDENCE is not set; run strict evidence on a clean HEAD before actual freeze operations"
  });
}

const result = {
  ok: blockers.length === 0,
  checkedAt: new Date().toISOString(),
  mode: {
    requireCleanGit,
    runStrictEvidence,
    sendsRefreshPost: false,
    sendsProductionWriteRequests: false,
    deploysNginx: false,
    freezesLegacyApi: false,
    switchesFactSource: false
  },
  environment: env,
  steps: {
    candidatePostRecoveryVerify: summarizeStep(postRecovery),
    stagingWriteTokenReadiness: summarizeStep(tokenReadiness),
    legacyFreezeStrictPreflight: summarizeStep(strictPreflight),
    legacyFreezeStrictEvidenceBundle: summarizeStep(strictEvidence)
  },
  checks,
  blockers,
  warnings,
  goNoGo: blockers.length === 0
    ? "freeze_retry_readiness_ready"
    : "no_go_clear_freeze_retry_readiness_blockers",
  notes: [
    "This retry readiness gate is local/read-only orchestration.",
    "It does not refresh quotes, deploy nginx, reload services, freeze legacy endpoints, send production write requests, write production databases, or switch fact source.",
    "Token values and database URLs are never printed.",
    "Before actual freeze operations, rerun on clean HEAD with LEGACY_FREEZE_RETRY_REQUIRE_CLEAN_GIT=1 and LEGACY_FREEZE_RETRY_RUN_STRICT_EVIDENCE=1."
  ]
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}

function buildPostRecoveryEnv() {
  return {
    ...process.env,
    CANDIDATE_PRODUCTION_BASE_URL: process.env.CANDIDATE_PRODUCTION_BASE_URL ?? process.env.LEGACY_FREEZE_CANDIDATE_BASE_URL ?? "",
    CANDIDATE_PRODUCTION_TLS_INSECURE: process.env.CANDIDATE_PRODUCTION_TLS_INSECURE ?? "0"
  };
}

function commandSpec(envName, fallback) {
  const raw = process.env[envName];
  if (!raw) return fallback;
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed.command !== "string" || !Array.isArray(parsed.args)) {
    throw new Error(`${envName} must be a JSON object with command and args`);
  }
  return {
    command: parsed.command,
    args: parsed.args.map(String)
  };
}

async function runStep(id, spec, stepEnv) {
  try {
    const result = await execFileAsync(spec.command, spec.args, {
      cwd: root,
      env: stepEnv,
      maxBuffer: 20 * 1024 * 1024
    });
    return normalizeStep(id, true, result.stdout, result.stderr, null);
  } catch (error) {
    return normalizeStep(
      id,
      false,
      String(error.stdout ?? ""),
      String(error.stderr ?? ""),
      error instanceof Error ? error.message : String(error)
    );
  }
}

function normalizeStep(id, ok, stdout, stderr, error) {
  return {
    id,
    ok,
    json: parseJson(stdout),
    stdoutPreview: preview(stdout),
    stderrPreview: sanitize(stderr),
    error
  };
}

function summarizeStep(step) {
  if (!step) return null;
  return {
    ok: step.ok,
    jsonOk: step.json?.ok ?? null,
    goNoGo: step.json?.goNoGo ?? null,
    stdoutPreview: step.json ? null : step.stdoutPreview,
    stderrPreview: step.stderrPreview,
    error: step.error
  };
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

function preview(value) {
  return sanitize(value).trim().slice(0, 300);
}

function sanitize(value) {
  return String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer <redacted>")
    .replace(/postgres(?:ql)?:\/\/[^\s"]+/gi, "postgres://<redacted>")
    .replace(/token["'=:\s]+[A-Za-z0-9._-]+/gi, "token=<redacted>")
    .slice(0, 1000);
}

function check(id, ok, evidence = undefined) {
  checks.push({ id, ok, evidence });
  if (!ok) {
    blockers.push({ id, evidence });
  }
}

function envSummary() {
  const names = [
    "CANDIDATE_PRODUCTION_BASE_URL",
    "STAGING_WRITE_BASE_URL",
    "STAGING_WRITE_TOKEN",
    "STAGING_DATABASE_URL",
    "DATA_GATE_SAMPLE_PATH",
    "LEGACY_FREEZE_BACKUP_PATH",
    "LEGACY_FREEZE_BACKUP_SHA256",
    "LEGACY_FREEZE_NGINX_BACKUP_PATH",
    "LEGACY_FREEZE_NGINX_BACKUP_SHA256",
    "LEGACY_FREEZE_LIVE_AUTHORIZATION",
    "LEGACY_FREEZE_LEGACY_BASE_URL",
    "LEGACY_FREEZE_CANDIDATE_BASE_URL"
  ];
  return Object.fromEntries(names.map((name) => [
    name,
    {
      present: Boolean(process.env[name]),
      valuePrinted: false
    }
  ]));
}

function includesCandidatePrefix(value) {
  return isHttpUrl(value) && String(value).includes("/candidate-api");
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function envPathExists(name) {
  const value = process.env[name] ?? "";
  if (!value) return false;
  const absolute = value.startsWith("/") ? value : join(root, value);
  try {
    return statSync(absolute).isFile();
  } catch {
    return false;
  }
}

function envShaMatches(pathName, shaName) {
  const expected = process.env[shaName] ?? "";
  if (!/^[a-f0-9]{64}$/i.test(expected) || !envPathExists(pathName)) return false;
  const filePath = process.env[pathName] ?? "";
  const absolute = filePath.startsWith("/") ? filePath : join(root, filePath);
  const actual = createHash("sha256").update(readFileSync(absolute)).digest("hex");
  return actual.toLowerCase() === expected.toLowerCase();
}
