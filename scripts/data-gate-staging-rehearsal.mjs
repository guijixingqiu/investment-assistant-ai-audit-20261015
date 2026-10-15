import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const samplePath = process.env.DATA_GATE_SAMPLE_PATH ?? "artifacts/data-gate/legacy-full-sample.json";
const databaseName = `annual_rings_staging_rehearsal_${Date.now()}`;
const databaseUrl = `postgres://localhost/${databaseName}`;
const workDir = await mkdtemp(path.join(tmpdir(), "annual-rings-staging-rehearsal-"));

try {
  await access(samplePath);
} catch {
  console.error(`未验证: full production sample file is missing: ${samplePath}`);
  process.exit(2);
}

try {
  await createCandidateDatabase();
  await importSample("staging-import-1");
  const firstCounts = await loadCounts();
  await importSample("staging-import-2");
  const secondCounts = await loadCounts();
  assertSameCounts(firstCounts, secondCounts, "repeat import must be idempotent");

  const badSamplePath = path.join(workDir, "bad-count-sample.json");
  await writeFile(badSamplePath, JSON.stringify(await badCountSample(), null, 2), "utf8");
  const failed = await runExpectFailure("node", ["scripts/data-gate-sample-reconcile.mjs"], {
    DATABASE_URL: databaseUrl,
    DATA_GATE_SAMPLE_PATH: badSamplePath,
    DATA_GATE_RUN_ID: "staging-bad-count"
  });
  if (failed.code === 0) {
    throw new Error("bad staging sample unexpectedly passed");
  }
  const afterFailureCounts = await loadCounts();
  assertSameCounts(secondCounts, afterFailureCounts, "failed import must not mutate successful sample counts");

  await dropCandidateDatabase();
  await createCandidateDatabase();
  await importSample("staging-recovery-import");
  const recoveryCounts = await loadCounts();
  assertSameCounts(firstCounts, recoveryCounts, "recovery import after database rebuild must match first import");

  console.log(JSON.stringify({
    ok: true,
    databaseName,
    samplePath,
    counts: recoveryCounts,
    checks: [
      "initial full sample import passed",
      "repeat import was idempotent",
      "bad sample failed without changing successful counts",
      "drop/recreate recovery import matched the original counts"
    ]
  }, null, 2));
} finally {
  await dropCandidateDatabase();
  await rm(workDir, { recursive: true, force: true });
}

async function createCandidateDatabase() {
  await run("createdb", [databaseName]);
  await run("npm", ["run", "migrate"], { DATABASE_URL: databaseUrl });
}

async function dropCandidateDatabase() {
  await run("dropdb", ["--if-exists", databaseName]);
}

async function importSample(runId) {
  await run("node", ["scripts/data-gate-sample-reconcile.mjs"], {
    DATABASE_URL: databaseUrl,
    DATA_GATE_SAMPLE_PATH: samplePath,
    DATA_GATE_RUN_ID: runId
  });
}

async function loadCounts() {
  const result = await run("psql", [
    "-d",
    databaseName,
    "-Atc",
    `select jsonb_build_object(
       'portfolioPositions', (select count(*)::integer from portfolio_positions),
       'decisionChecks', (select count(*)::integer from pre_trade_decision_checks),
       'stockResearchEvents', (select count(*)::integer from migrated_research_events),
       'globalResearchEvents', (select count(*)::integer from legacy_research_events),
       'succeededRuns', (select count(*)::integer from data_migration_runs where status = 'succeeded'),
       'failedRuns', (select count(*)::integer from data_migration_runs where status = 'failed')
     )::text;`
  ]);
  return JSON.parse(result.stdout.trim());
}

async function badCountSample() {
  const { readFile } = await import("node:fs/promises");
  const sample = JSON.parse(await readFile(samplePath, "utf8"));
  return {
    ...sample,
    sourceLabel: "negative-staging-count-mismatch",
    expectedCounts: {
      ...sample.expectedCounts,
      positions: Number(sample.expectedCounts.positions) + 1
    }
  };
}

function assertSameCounts(left, right, message) {
  const keys = ["portfolioPositions", "decisionChecks", "stockResearchEvents", "globalResearchEvents"];
  for (const key of keys) {
    if (Number(left[key]) !== Number(right[key])) {
      throw new Error(`${message}: ${key} changed from ${left[key]} to ${right[key]}`);
    }
  }
}

async function run(command, args, extraEnv = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...extraEnv },
      maxBuffer: 30 * 1024 * 1024
    });
    if (result.stdout.trim()) console.log(result.stdout.trim());
    if (result.stderr.trim()) console.error(result.stderr.trim());
    return result;
  } catch (error) {
    if (error && typeof error === "object") {
      const maybeOutput = error;
      if (typeof maybeOutput.stdout === "string" && maybeOutput.stdout.trim()) console.log(maybeOutput.stdout.trim());
      if (typeof maybeOutput.stderr === "string" && maybeOutput.stderr.trim()) console.error(maybeOutput.stderr.trim());
    }
    throw error;
  }
}

async function runExpectFailure(command, args, extraEnv = {}) {
  try {
    const result = await run(command, args, extraEnv);
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (error && typeof error === "object" && typeof error.code === "number") {
      return { code: error.code };
    }
    return { code: 1 };
  }
}
