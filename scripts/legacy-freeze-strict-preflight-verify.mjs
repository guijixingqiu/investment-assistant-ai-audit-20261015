#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const workDir = mkdtempSync(join(tmpdir(), "annual-rings-freeze-strict-"));
const samplePath = join(workDir, "latest-sample.json");
const dbBackupPath = join(workDir, "production.dump");
const nginxBackupPath = join(workDir, "nginx.conf.before-freeze");
const expectedAuthorization = "授权进入旧系统研究/证据/决策检查写入口冻结窗口";

mkdirSync(workDir, { recursive: true });
writeFileSync(samplePath, JSON.stringify({
  sourceLabel: "strict-preflight-verify",
  expectedCounts: { positions: 0, decisionChecks: 0, researchEvents: 0, trades: 0, reviews: 0 },
  notes: ["synthetic sample for strict preflight verification only"]
}, null, 2));
writeFileSync(dbBackupPath, "synthetic production backup bytes\n");
writeFileSync(nginxBackupPath, "synthetic nginx backup bytes\n");

const baseEnv = {
  LEGACY_FREEZE_PREFLIGHT_REQUIRE_PRODUCTION_ENV: "1",
  LEGACY_FREEZE_REQUIRE_PRODUCTION_ENV: "1",
  CANDIDATE_PRODUCTION_BASE_URL: "https://audit-service.example.invalid:18443/candidate-api",
  STAGING_WRITE_BASE_URL: "https://audit-service.example.invalid:18443/candidate-api",
  STAGING_WRITE_TOKEN: "synthetic-token-not-real",
  STAGING_DATABASE_URL: "postgres://synthetic:redacted@example.invalid:5432/candidate",
  DATA_GATE_SAMPLE_PATH: samplePath,
  LEGACY_FREEZE_BACKUP_PATH: dbBackupPath,
  LEGACY_FREEZE_BACKUP_SHA256: sha256(dbBackupPath),
  LEGACY_FREEZE_NGINX_BACKUP_PATH: nginxBackupPath,
  LEGACY_FREEZE_NGINX_BACKUP_SHA256: sha256(nginxBackupPath),
  LEGACY_FREEZE_LIVE_AUTHORIZATION: expectedAuthorization,
  LEGACY_FREEZE_LEGACY_BASE_URL: "https://audit-service.example.invalid:18443",
  LEGACY_FREEZE_CANDIDATE_BASE_URL: "https://audit-service.example.invalid:18443/candidate-api"
};

const cases = [
  {
    id: "strict-positive",
    env: baseEnv,
    expectOk: true,
    expectedBlockerIncludes: []
  },
  {
    id: "wrong-candidate-url",
    env: { ...baseEnv, CANDIDATE_PRODUCTION_BASE_URL: "https://audit-service.example.invalid:18443/api" },
    expectOk: false,
    expectedBlockerIncludes: ["production-env-CANDIDATE_PRODUCTION_BASE_URL"]
  },
  {
    id: "wrong-db-backup-sha",
    env: { ...baseEnv, LEGACY_FREEZE_BACKUP_SHA256: "0".repeat(64) },
    expectOk: false,
    expectedBlockerIncludes: ["production-env-LEGACY_FREEZE_BACKUP_SHA256"]
  },
  {
    id: "wrong-nginx-backup-sha",
    env: { ...baseEnv, LEGACY_FREEZE_NGINX_BACKUP_SHA256: "1".repeat(64) },
    expectOk: false,
    expectedBlockerIncludes: ["production-env-LEGACY_FREEZE_NGINX_BACKUP_SHA256"]
  },
  {
    id: "wrong-authorization",
    env: { ...baseEnv, LEGACY_FREEZE_LIVE_AUTHORIZATION: "授权" },
    expectOk: false,
    expectedBlockerIncludes: ["production-env-LEGACY_FREEZE_LIVE_AUTHORIZATION"]
  },
  {
    id: "legacy-url-uses-candidate-prefix",
    env: { ...baseEnv, LEGACY_FREEZE_LEGACY_BASE_URL: "https://audit-service.example.invalid:18443/candidate-api" },
    expectOk: false,
    expectedBlockerIncludes: ["production-env-LEGACY_FREEZE_LEGACY_BASE_URL"]
  }
];

const results = [];
for (const item of cases) {
  const result = await runPreflight(item.env);
  const blockerIds = (result.output?.blockers ?? []).map((blocker) => blocker.id);
  const okMatches = result.ok === item.expectOk;
  const blockersMatch = item.expectedBlockerIncludes.every((id) => blockerIds.includes(id));
  results.push({
    id: item.id,
    ok: okMatches && blockersMatch,
    expectedOk: item.expectOk,
    actualOk: result.ok,
    blockerIds,
    tokenPrinted: outputIncludesSecret(result.raw),
    databaseUrlPrinted: result.raw.includes("synthetic:redacted")
  });
}

const ok = results.every((item) => item.ok && !item.tokenPrinted && !item.databaseUrlPrinted);
console.log(JSON.stringify({
  ok,
  checkedAt: new Date().toISOString(),
  workDir,
  caseCount: results.length,
  results,
  notes: [
    "This verifier uses synthetic local files and synthetic secret values only.",
    "It does not deploy nginx, reload services, freeze legacy endpoints, send production HTTP requests, or write production databases.",
    "It asserts strict preflight rejects wrong URLs, wrong sha256 values, and wrong authorization without printing token or database URL values."
  ]
}, null, 2));

if (!ok) process.exit(1);

async function runPreflight(extraEnv) {
  try {
    const result = await execFileAsync(process.execPath, ["scripts/legacy-freeze-preflight.mjs"], {
      cwd: root,
      env: { ...process.env, ...extraEnv },
      maxBuffer: 20 * 1024 * 1024
    });
    return {
      ok: true,
      output: parseJson(result.stdout),
      raw: `${result.stdout}\n${result.stderr}`
    };
  } catch (error) {
    const raw = `${String(error.stdout ?? "")}\n${String(error.stderr ?? "")}`;
    return {
      ok: false,
      output: parseJson(raw),
      raw
    };
  }
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
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

function outputIncludesSecret(text) {
  return text.includes("synthetic-token-not-real");
}
