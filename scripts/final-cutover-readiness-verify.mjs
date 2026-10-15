import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const samplePath = process.env.DATA_GATE_SAMPLE_PATH ?? "artifacts/data-gate/legacy-full-sample.json";
const databaseName = `annual_rings_cutover_readiness_${Date.now()}`;
const databaseUrl = `postgres://localhost/${databaseName}`;

try {
  await access(samplePath);
} catch {
  console.error(`未验证: full production sample file is missing: ${samplePath}`);
  process.exit(2);
}

try {
  await run("createdb", [databaseName]);
  await run("npm", ["run", "migrate"], { DATABASE_URL: databaseUrl });
  await run("node", ["scripts/data-gate-sample-reconcile.mjs"], {
    DATABASE_URL: databaseUrl,
    DATA_GATE_SAMPLE_PATH: samplePath,
    DATA_GATE_RUN_ID: "final-cutover-readiness-verify"
  });
  await run("node", ["scripts/final-cutover-readiness.mjs"], {
    STAGING_DATABASE_URL: databaseUrl,
    DATA_GATE_SAMPLE_PATH: samplePath,
    FINAL_CUTOVER_MAX_SAMPLE_AGE_HOURS: "100000"
  });

  await run("psql", [
    "-d",
    databaseName,
    "-Atc",
    "delete from migrated_research_events where legacy_id = (select legacy_id from migrated_research_events order by legacy_id limit 1);"
  ]);
  const failed = await runExpectFailure("node", ["scripts/final-cutover-readiness.mjs"], {
    STAGING_DATABASE_URL: databaseUrl,
    DATA_GATE_SAMPLE_PATH: samplePath,
    FINAL_CUTOVER_MAX_SAMPLE_AGE_HOURS: "100000"
  });
  if (failed.code === 0) {
    throw new Error("final cutover readiness negative check unexpectedly passed");
  }

  console.log(JSON.stringify({
    ok: true,
    databaseName,
    samplePath,
    checks: [
      "positive readiness check passed against a fully imported candidate database",
      "negative readiness check failed after deleting one migrated research event",
      "temporary database cleanup will run after verification"
    ]
  }, null, 2));
} finally {
  await run("dropdb", ["--if-exists", databaseName]);
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
