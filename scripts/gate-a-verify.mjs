import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const databaseName = `annual_rings_gate_a_verify_${Date.now()}`;
const databaseUrl = `postgres://localhost/${databaseName}`;

try {
  await run("createdb", [databaseName]);
  console.log(`created ${databaseName}`);

  await run("npm", ["run", "migrate"], { DATABASE_URL: databaseUrl });
  await run("node", ["tests/smoke/gate-a-api-smoke.mjs"], {
    DATABASE_URL: databaseUrl,
    PORT: "4410"
  });

  const count = await run("psql", ["-d", databaseName, "-Atc", "select count(*) from market_quotes;"]);
  if (count.stdout.trim() !== "1") {
    throw new Error(`expected 1 persisted quote, got ${count.stdout.trim() || "<empty>"}`);
  }
  console.log("Gate A migration/API smoke persisted 1 market quote.");

  await run("psql", [
    "-d",
    databaseName,
    "-Atc",
    "update market_quotes set quote_time = now() - interval '10 minutes' where market = 'HK' and code = '09926';"
  ]);
  const stale = await run("node", ["scripts/read-market-quote.mjs", "HK", "09926"], {
    DATABASE_URL: databaseUrl,
    QUOTE_LIVE_MAX_AGE_SECONDS: "60"
  });
  const staleEnvelope = JSON.parse(stale.stdout.trim().split("\n").at(-1));
  if (staleEnvelope.status !== "stale" || staleEnvelope.data?.symbol !== "HK.09926") {
    throw new Error(`expected stale cached quote, got ${JSON.stringify(staleEnvelope)}`);
  }
  console.log("Gate A stale cache check passed for HK.09926.");
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
