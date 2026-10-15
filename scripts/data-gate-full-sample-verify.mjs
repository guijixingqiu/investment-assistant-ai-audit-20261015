import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const samplePath = process.env.DATA_GATE_SAMPLE_PATH ?? "artifacts/data-gate/legacy-full-sample.json";
const databaseName = `annual_rings_full_sample_${Date.now()}`;
const databaseUrl = `postgres://localhost/${databaseName}`;

try {
  await access(samplePath);
} catch {
  console.error(`未验证: full production sample file is missing: ${samplePath}`);
  process.exit(2);
}

try {
  await run("createdb", [databaseName]);
  console.log(`created ${databaseName}`);

  await run("npm", ["run", "migrate"], { DATABASE_URL: databaseUrl });
  await run("node", ["scripts/data-gate-sample-reconcile.mjs"], {
    DATABASE_URL: databaseUrl,
    DATA_GATE_SAMPLE_PATH: samplePath,
    DATA_GATE_RUN_ID: "full-sample-verify"
  });

  const counts = await run("psql", [
    "-d",
    databaseName,
    "-Atc",
    `select 'portfolio_positions|' || count(*) from portfolio_positions
     union all select 'pre_trade_decision_checks|' || count(*) from pre_trade_decision_checks
     union all select 'migrated_research_events|' || count(*) from migrated_research_events
     union all select 'legacy_research_events|' || count(*) from legacy_research_events
     union all select 'succeeded_runs|' || count(*) from data_migration_runs where status = 'succeeded'
     order by 1;`
  ]);
  console.log(counts.stdout.trim());
  console.log("Data gate full production sample reconciliation passed.");
} finally {
  try {
    await run("dropdb", ["--if-exists", databaseName]);
    console.log(`dropped ${databaseName}`);
  } catch (error) {
    console.error(`未验证: failed to drop temporary database ${databaseName}.`);
    throw error;
  }
}

async function run(command, args, extraEnv = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...extraEnv
      },
      maxBuffer: 20 * 1024 * 1024
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
