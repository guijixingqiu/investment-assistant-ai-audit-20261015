import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const databaseName = `annual_rings_data_gate_${Date.now()}`;
const databaseUrl = `postgres://localhost/${databaseName}`;

try {
  await run("createdb", [databaseName]);
  console.log(`created ${databaseName}`);

  await run("npm", ["run", "migrate"], { DATABASE_URL: databaseUrl });
  await run("node", ["scripts/data-gate-sample-reconcile.mjs"], {
    DATABASE_URL: databaseUrl,
    DATA_GATE_RUN_ID: "data-gate-verify"
  });

  const counts = await run("psql", [
    "-d",
    databaseName,
    "-Atc",
    `select 'portfolio_positions|' || count(*) from portfolio_positions
     union all select 'pre_trade_decision_checks|' || count(*) from pre_trade_decision_checks
     union all select 'migrated_research_events|' || count(*) from migrated_research_events
     union all select 'data_migration_runs|' || count(*) from data_migration_runs
     union all select 'succeeded_runs|' || count(*) from data_migration_runs where status = 'succeeded'
     order by 1;`
  ]);
  const parsed = Object.fromEntries(counts.stdout.trim().split("\n").map((line) => line.split("|")));
  assertCount(parsed, "portfolio_positions", "1");
  assertCount(parsed, "pre_trade_decision_checks", "1");
  assertCount(parsed, "migrated_research_events", "2");
  assertCount(parsed, "data_migration_runs", "1");
  assertCount(parsed, "succeeded_runs", "1");
  console.log("Data gate sample migration/reconciliation smoke persisted positions, decision checks, research events, and a succeeded run.");
} finally {
  try {
    await run("dropdb", ["--if-exists", databaseName]);
    console.log(`dropped ${databaseName}`);
  } catch (error) {
    console.error(`未验证: failed to drop temporary database ${databaseName}.`);
    throw error;
  }
}

function assertCount(counts, table, expected) {
  if (counts[table] !== expected) {
    throw new Error(`expected ${table} count ${expected}, got ${counts[table] ?? "<missing>"}`);
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
      maxBuffer: 10 * 1024 * 1024
    });
    if (result.stdout.trim()) {
      console.log(result.stdout.trim());
    }
    if (result.stderr.trim()) {
      console.error(result.stderr.trim());
    }
    return result;
  } catch (error) {
    if (error && typeof error === "object") {
      const maybeOutput = error;
      if (typeof maybeOutput.stdout === "string" && maybeOutput.stdout.trim()) {
        console.log(maybeOutput.stdout.trim());
      }
      if (typeof maybeOutput.stderr === "string" && maybeOutput.stderr.trim()) {
        console.error(maybeOutput.stderr.trim());
      }
    }
    throw error;
  }
}
