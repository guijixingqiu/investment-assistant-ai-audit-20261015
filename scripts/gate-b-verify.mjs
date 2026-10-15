import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";

const CLEANUP_COMMAND_TIMEOUT_MS = 15_000;
const COMMAND_TERMINATION_GRACE_MS = 2_000;
const COMMAND_GROUP_TERMINATION_TIMEOUT_MS = 500;
const COMMAND_GROUP_PROBE_INTERVAL_MS = 10;
const postgresEndpoint = resolveLocalPostgresEndpoint(process.env, userInfo().username);
const runId = `${Date.now()}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
const sourceDatabaseName = `annual_rings_gate_b_source_${runId}`;
const restoredDatabaseName = `annual_rings_gate_b_restore_${runId}`;
const sourceDatabaseUrl = localDatabaseUrl(sourceDatabaseName);
const restoredDatabaseUrl = localDatabaseUrl(restoredDatabaseName);
const repositoryRoot = resolve(".");
const port = String(45_000 + Math.floor(Math.random() * 10_000));
const expectedMigrations = (await readdir(join(repositoryRoot, "db/migrations")))
  .filter((file) => file.endsWith(".sql") && !file.startsWith("._"))
  .sort();
assert.ok(expectedMigrations.length > 0, "Migration inventory must not be empty");
const expectedMigrationChecksums = await Promise.all(expectedMigrations.map(async (filename) =>
  `${filename}|${createHash("sha256").update(await readFile(join(repositoryRoot, "db/migrations", filename))).digest("hex")}`
));

const canonicalRelations = [
  "schema_migrations",
  "stocks",
  "market_quotes",
  "data_refresh_runs",
  "research_profiles",
  "evidence_items",
  "ai_update_suggestions",
  "ai_suggestion_decisions",
  "candidate_memberships",
  "candidate_membership_audit_events",
  "research_fixture_seed_events",
  "pre_trade_decision_checks",
  "post_decision_reviews",
  "research_write_audit_events",
  "portfolio_positions",
  "migrated_research_events",
  "legacy_research_events",
  "data_migration_runs",
  "broker_import_batches",
  "broker_raw_transactions",
  "broker_trades",
  "positions",
  "position_snapshots",
  "pingan_import_batch_manifests",
  "pingan_imported_snapshot_positions",
  "pingan_imported_snapshot_conflicts",
  "research_materials",
  "research_evidence_packs",
  "deep_research_reports",
  "deep_research_report_decisions",
  "research_events",
  "geely_sales_monitor_runs",
  "gcl_pv_price_monitor_runs"
];
const expectedCounts = {
  schema_migrations: expectedMigrations.length,
  market_quotes: 2,
  research_profiles: 1,
  evidence_items: 2,
  ai_update_suggestions: 1,
  ai_suggestion_decisions: 0,
  candidate_memberships: 1,
  candidate_membership_audit_events: 1,
  research_fixture_seed_events: 1,
  pre_trade_decision_checks: 1,
  post_decision_reviews: 1,
  research_write_audit_events: 2,
  pingan_import_batch_manifests: 1,
  pingan_imported_snapshot_positions: 2,
  portfolio_positions: 0,
  research_events: 0,
  geely_sales_monitor_runs: 0,
  gcl_pv_price_monitor_runs: 0
};
let activeSignalContext = null;

class GateBInterruptedError extends Error {
  constructor(signal, options) {
    super(`Gate B interrupted by ${signal}`);
    this.name = "GateBInterruptedError";
    this.signal = signal;
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

class GateBCommandTerminationError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "GateBCommandTerminationError";
    if (options.code !== undefined) this.code = options.code;
    if (options.signal !== undefined) this.signal = options.signal;
    this.killed = options.killed ?? false;
  }
}

const directExecutionUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (import.meta.url === directExecutionUrl) await main();

async function main() {
  let temporaryDirectory;
  const outcome = await executeWithGateBSignalCleanup({
    execute: async () => {
      temporaryDirectory = await mkdtemp(join(tmpdir(), "annual-rings-gate-b-recovery-"));
      await executeGateBRecovery(temporaryDirectory);
    },
    cleanup: () => cleanupGateBDatabasesAndFiles(temporaryDirectory)
  });
  if (!outcome.interruptedSignal) return;
  console.error(`Gate B interrupted by ${outcome.interruptedSignal}; local databases and temporary files were cleaned.`);
  process.exitCode = outcome.interruptedSignal === "SIGINT" ? 130 : 143;
}

async function executeGateBRecovery(temporaryDirectory) {
  const dumpPath = join(temporaryDirectory, "gate-b-source.pgcustom");
  const workflowWitnessPath = join(temporaryDirectory, "workflow-witness.json");

  await runPostgresCommand("createdb", [...postgresCliConnectionArgs(), sourceDatabaseName]);
  console.log(`created disposable Gate B source database ${sourceDatabaseName}`);
  await runPostgresCommand("psql", [
    "--no-psqlrc",
    ...postgresCliConnectionArgs(),
    "-v", "ON_ERROR_STOP=1",
    "-d", sourceDatabaseName,
    "-f", "tests/fixtures/gate-b-annual-postgres-witness.sql"
  ]);
  await run("npm", ["run", "migrate"], { DATABASE_URL: sourceDatabaseUrl });
  await seedPinganFullSnapshotManifest(sourceDatabaseName);
  await assertExactMigrations(sourceDatabaseName);

  await run("npm", ["run", "quant-freeze-snapshot:multi"]);
  await run("npm", ["run", "quant-portfolio-lab-evidence"]);
  await run("npm", ["run", "quant-shadow-portfolio"]);

  const portfolioManifest = await bindManifest(
    repositoryRoot,
    "artifacts/quant-portfolio-lab/latest/run_manifest.json",
    "annual portfolio lab"
  );
  const decisionManifest = await bindManifest(
    repositoryRoot,
    "artifacts/quant-shadow-portfolio/latest/run_manifest.json",
    "quant research decision"
  );
  const smokeEnvironment = {
    PORT: port,
    QUANT_EVIDENCE_REPOSITORY_ROOT: repositoryRoot,
    ANNUAL_PORTFOLIO_LAB_EVIDENCE_MANIFEST: portfolioManifest.path,
    ANNUAL_PORTFOLIO_LAB_EVIDENCE_MANIFEST_SHA256: portfolioManifest.sha256,
    QUANT_RESEARCH_EVIDENCE_MANIFEST: decisionManifest.path,
    QUANT_RESEARCH_EVIDENCE_MANIFEST_SHA256: decisionManifest.sha256,
    QUANT_RESEARCH_EVIDENCE_MAX_AGE_DAYS: "3650",
    GATE_B_WORKFLOW_WITNESS_PATH: workflowWitnessPath
  };

  await run("node", ["tests/smoke/gate-b-research-smoke.mjs"], {
    ...smokeEnvironment,
    DATABASE_URL: sourceDatabaseUrl
  });
  const workflowWitness = await bindWorkflowWitness(workflowWitnessPath);
  const sourceContent = await canonicalDatabaseContent(sourceDatabaseUrl);
  assertExpectedCounts(sourceContent.counts);

  await runPostgresCommand("pg_dump", [
    ...postgresCliConnectionArgs(),
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    "--file", dumpPath,
    sourceDatabaseName
  ]);
  const dumpBytes = await readFile(dumpPath);
  assert(dumpBytes.length > 0, "Gate B custom-format PostgreSQL dump must not be empty");
  const dumpSha256 = sha256(dumpBytes);

  await runPostgresCommand("createdb", [...postgresCliConnectionArgs(), restoredDatabaseName]);
  console.log(`created disposable Gate B restore database ${restoredDatabaseName}`);
  await runPostgresCommand("pg_restore", [
    ...postgresCliConnectionArgs(),
    "--exit-on-error",
    "--no-owner",
    "--no-privileges",
    "--dbname", restoredDatabaseName,
    dumpPath
  ]);
  await assertExactMigrations(restoredDatabaseName);
  const restoredContent = await canonicalDatabaseContent(restoredDatabaseUrl);
  assert.equal(
    restoredContent.sha256,
    sourceContent.sha256,
    "restored PostgreSQL row-content hash must exactly match the source database"
  );
  assert.deepEqual(restoredContent.counts, sourceContent.counts, "restored relation counts must match the source database");
  assertMatchingSequenceStates(sourceContent.ownedSequences, restoredContent.ownedSequences);

  const sequenceContinuity = await proveOwnedSequenceNextValueContinuity({
    sourceDatabaseUrl,
    restoredDatabaseUrl,
    ownedSequences: sourceContent.ownedSequences
  });
  const postSequenceProbeSourceContent = await canonicalDatabaseContent(sourceDatabaseUrl);
  const postSequenceProbeRestoredContent = await canonicalDatabaseContent(restoredDatabaseUrl);
  assert.equal(
    postSequenceProbeRestoredContent.sha256,
    postSequenceProbeSourceContent.sha256,
    "source and restored databases must remain identical after matching nextval probes"
  );

  const restoredSmoke = await run("node", ["tests/smoke/gate-b-research-smoke.mjs"], {
    ...smokeEnvironment,
    DATABASE_URL: restoredDatabaseUrl,
    GATE_B_RESTORED_REPLAY: "1",
    GATE_B_WORKFLOW_WITNESS_SHA256: workflowWitness.sha256
  });
  const performance = parseResultMarker(restoredSmoke.stdout, "GATE_B_LOCAL_PERFORMANCE_RESULT=");
  assert.equal(
    performance.interpretation,
    "local_regression_guard_not_staging_or_production_capacity_evidence"
  );
  assert.equal(performance.breached, false, "restored local API performance regression budget must pass");

  const postReplayContent = await canonicalDatabaseContent(restoredDatabaseUrl);
  assert.equal(
    postReplayContent.sha256,
    postSequenceProbeSourceContent.sha256,
    "exact restored API replay must not change canonical PostgreSQL row content"
  );
  assert.deepEqual(postReplayContent.counts, postSequenceProbeSourceContent.counts, "restored replay must not change relation counts");

  console.log("Gate B native PostgreSQL backup/restore and exact API replay passed without protected-fact mutation.");
  console.log(`GATE_B_RECOVERY_CAPACITY_RESULT=${JSON.stringify({
    schemaVersion: "2026-07-18.gate-b-recovery-capacity.v1",
    interpretation: "local_recovery_and_regression_evidence_only",
    sourceDatabaseContentSha256: sourceContent.sha256,
    restoredDatabaseContentSha256: restoredContent.sha256,
    postSequenceProbeSourceContentSha256: postSequenceProbeSourceContent.sha256,
    postSequenceProbeRestoredContentSha256: postSequenceProbeRestoredContent.sha256,
    postReplayDatabaseContentSha256: postReplayContent.sha256,
    canonicalRelationCounts: sourceContent.counts,
    canonicalOwnedSequenceCount: sourceContent.sequenceCount,
    sequenceContinuity,
    canonicalContentBytes: sourceContent.bytes,
    dump: { format: "postgresql_custom", sha256: dumpSha256, bytes: dumpBytes.length },
    workflowWitnessSha256: workflowWitness.sha256,
    performance
  })}`);
}

async function seedPinganFullSnapshotManifest(databaseName) {
  await runPostgresCommand("psql", [
    "--no-psqlrc",
    ...postgresCliConnectionArgs(),
    "-v", "ON_ERROR_STOP=1",
    "-d", databaseName,
    "-c", `insert into pingan_import_batch_manifests
      (batch_id, account_scope_id, manifest_version, is_full_snapshot,
       expected_position_count, expected_symbols, expected_symbols_sha256,
       expected_position_facts_sha256, expected_batch_imported_at,
       snapshot_group_id, source_as_of, source_fetched_at,
       position_snapshot_ids, created_at)
      select '9001', 'owner-main',
             '2026-07-19.pingan-full-account-snapshot.v1', true,
             2, array['HK.03800', 'HK.09926'],
             '4a7162214d76faa26994e43ea380f1761fb0ca31fa7209157e46126212c48642',
             pingan_import_batch_position_facts_sha256(
               '9001', 'owner-main', array['9201', '9202']
             ),
             (select created_at from broker_import_batches where id = 9001),
             'gate-b-owner-main-9001',
             (select snapshot_as_of from position_snapshots where id = 9201),
             (select max(created_at) from position_snapshots where id in (9201, 9202)),
             array['9201', '9202'],
             (select max(created_at) from position_snapshots where id in (9201, 9202));`
  ]);
}

async function canonicalDatabaseContent(databaseUrl) {
  const pool = localPool(databaseUrl);
  const client = await pool.connect();
  try {
    await client.query("set timezone to 'UTC'");
    const tables = {};
    const counts = {};
    for (const relation of canonicalRelations) {
      activeSignalContext?.throwIfInterrupted();
      assert(/^[a-z][a-z0-9_]*$/.test(relation), `unsafe canonical relation name: ${relation}`);
      const result = await client.query(
        `select to_jsonb(item)::text as row from "${relation}" item order by to_jsonb(item)::text`
      );
      tables[relation] = result.rows.map((row) => row.row);
      counts[relation] = result.rows.length;
    }
    const sequences = await canonicalOwnedSequences(client);
    assert(Object.keys(sequences).length > 0, "Gate B canonical content must include owned sequence state");
    const canonical = JSON.stringify({
      schemaVersion: "2026-07-18.gate-b-postgresql-row-content.v1",
      relations: tables,
      ownedSequences: sequences
    });
    return {
      sha256: sha256(canonical),
      bytes: Buffer.byteLength(canonical),
      counts,
      sequenceCount: Object.keys(sequences).length,
      ownedSequences: sequences
    };
  } finally {
    client.release();
    await pool.end();
  }
}

async function assertExactMigrations(databaseName) {
  const result = await runPostgresCommand("psql", [
    "--no-psqlrc",
    ...postgresCliConnectionArgs(),
    "-d", databaseName, "-Atc",
    "select filename, checksum from schema_migrations order by filename;"
  ]);
  const actual = result.stdout.trim().split("\n").filter(Boolean);
  assert.deepEqual(actual, expectedMigrationChecksums, "Gate B must preserve the current migration inventory and exact checksums");
}

async function bindManifest(root, path, label) {
  const absolutePath = resolve(root, path);
  const raw = await readFile(absolutePath);
  if (raw.length === 0) throw new Error(`${label} manifest is empty`);
  let value;
  try {
    value = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error(`${label} manifest is not valid JSON`);
  }
  if (!value || typeof value !== "object" || value.ok === false) {
    throw new Error(`${label} manifest is not a successful evidence artifact`);
  }
  return { path, sha256: sha256(raw) };
}

async function bindWorkflowWitness(path) {
  const metadata = await lstat(path);
  assert(metadata.isFile() && !metadata.isSymbolicLink(), "workflow witness must be a regular file");
  assert.equal(metadata.mode & 0o077, 0, "workflow witness must not grant group or other permissions");
  const raw = await readFile(path);
  const value = JSON.parse(raw.toString("utf8"));
  assert.equal(value.schemaVersion, "2026-07-18.gate-b-workflow-witness.v1");
  for (const [label, entry] of [["decision", value.decision], ["review", value.review]]) {
    assert(entry && typeof entry === "object", `${label} workflow witness entry is required`);
    assert.equal(typeof entry.requestBody, "string", `${label} request bytes are required`);
    assert.equal(typeof entry.responseBody, "string", `${label} response bytes are required`);
    JSON.parse(entry.requestBody);
    JSON.parse(entry.responseBody);
  }
  return { sha256: sha256(raw) };
}

function assertExpectedCounts(counts) {
  for (const [relation, expected] of Object.entries(expectedCounts)) {
    assert.equal(counts[relation], expected, `expected ${relation} count ${expected}`);
  }
}

function parseResultMarker(stdout, marker) {
  const line = stdout.trim().split("\n").findLast((candidate) => candidate.startsWith(marker));
  if (!line) throw new Error(`required result marker ${marker} was not emitted`);
  return JSON.parse(line.slice(marker.length));
}

async function cleanupGateBDatabasesAndFiles(temporaryDirectory) {
  const failures = [];
  for (const databaseName of [restoredDatabaseName, sourceDatabaseName]) {
    try {
      await runPostgresCommand(
        "dropdb",
        [...postgresCliConnectionArgs(), "--if-exists", "--force", databaseName],
        { allowAfterSignal: true, timeoutMs: CLEANUP_COMMAND_TIMEOUT_MS }
      );
      console.log(`dropped disposable Gate B database ${databaseName}`);
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(`failed to drop ${databaseName}: ${String(error)}`));
    }
  }
  if (temporaryDirectory) {
    try {
      await rm(temporaryDirectory, { recursive: true, force: true });
      console.log("removed disposable Gate B recovery files");
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(`failed to remove Gate B recovery files: ${String(error)}`));
    }
  }
  return failures;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function run(
  command,
  args,
  extraEnvironment = {},
  {
    allowAfterSignal = false,
    maxBufferBytes = 40 * 1024 * 1024,
    timeoutMs,
    terminationGraceMs = COMMAND_TERMINATION_GRACE_MS,
    processKill = (pid, signal) => process.kill(pid, signal)
  } = {}
) {
  assert.equal(typeof processKill, "function", "Gate B processKill must be a function");
  assert(Number.isSafeInteger(maxBufferBytes) && maxBufferBytes > 0, "Gate B maxBufferBytes must be a positive integer");
  if (!allowAfterSignal) activeSignalContext?.throwIfInterrupted();
  const execution = executeFile(command, args, {
    cwd: process.cwd(),
    env: commandEnvironment(extraEnvironment),
    maxBuffer: maxBufferBytes,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    terminationGraceMs,
    processKill
  });
  const commandControl = allowAfterSignal ? null : execution.control;
  activeSignalContext?.activateCommand(commandControl);
  try {
    const result = await execution.promise;
    if (result.stdout.trim()) console.log(result.stdout.trim());
    if (result.stderr.trim()) console.error(result.stderr.trim());
    if (!allowAfterSignal) activeSignalContext?.throwIfInterrupted();
    return result;
  } catch (error) {
    if (error && typeof error === "object") {
      if (typeof error.stdout === "string" && error.stdout.trim()) console.log(error.stdout.trim());
      if (typeof error.stderr === "string" && error.stderr.trim()) console.error(error.stderr.trim());
    }
    if (!allowAfterSignal
      && activeSignalContext?.interruptedSignal
      && !(error instanceof GateBInterruptedError)
      && !(error instanceof GateBCommandTerminationError)) {
      throw new GateBInterruptedError(activeSignalContext.interruptedSignal, { cause: error });
    }
    throw error;
  } finally {
    activeSignalContext?.deactivateCommand(commandControl);
  }
}

function executeFile(command, args, options) {
  let abortReason = null;
  let escalationStarted = false;
  let childClose = null;
  let forceKillTimer = null;
  let groupProbeTimer = null;
  let groupTerminationRequired = false;
  let groupTerminationVerified = false;
  let terminationError = null;
  let settled = false;
  let timeoutError = null;
  let streamError = null;
  let spawnError = null;
  let stdoutBytes = 0;
  let stderrBytes = 0;
  const stdoutChunks = [];
  const stderrChunks = [];
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const processGroupId = process.platform === "win32" || !Number.isInteger(child.pid)
    ? null
    : child.pid;

  let settleExecution = () => {};
  const clearTerminationTimers = () => {
    if (forceKillTimer) clearTimeout(forceKillTimer);
    forceKillTimer = null;
    if (groupProbeTimer) clearTimeout(groupProbeTimer);
    groupProbeTimer = null;
  };
  const recordTerminationError = (error) => {
    if (settled || terminationError) return;
    terminationError = error;
    clearTerminationTimers();
    settleExecution();
  };
  const signalCommand = (signal) => {
    try {
      return signalChildProcessGroup(child, processGroupId, signal, options.processKill);
    } catch (cause) {
      throw commandTerminationError(command, processGroupId, `send ${signal} to`, cause, { signal });
    }
  };
  const verifyProcessGroup = () => {
    if (processGroupId === null) return childClose !== null;
    try {
      return !processGroupExists(processGroupId, options.processKill);
    } catch (cause) {
      throw commandTerminationError(command, processGroupId, "probe", cause);
    }
  };
  const markGroupTerminationVerified = () => {
    if (groupTerminationVerified) return;
    groupTerminationVerified = true;
    clearTerminationTimers();
    settleExecution();
  };
  const pollForGroupTermination = () => {
    const deadline = Date.now() + COMMAND_GROUP_TERMINATION_TIMEOUT_MS;
    const poll = () => {
      if (settled || terminationError || groupTerminationVerified) return;
      let terminated;
      try {
        terminated = verifyProcessGroup();
      } catch (error) {
        recordTerminationError(error);
        return;
      }
      if (terminated) {
        markGroupTerminationVerified();
        return;
      }
      if (Date.now() >= deadline) {
        recordTerminationError(new GateBCommandTerminationError(
          `Gate B command group ${processGroupId} did not disappear within ${COMMAND_GROUP_TERMINATION_TIMEOUT_MS}ms after SIGKILL`,
          { code: "ETIMEDOUT", signal: "SIGKILL", killed: true }
        ));
        return;
      }
      groupProbeTimer = setTimeout(poll, COMMAND_GROUP_PROBE_INTERVAL_MS);
    };
    groupProbeTimer = setTimeout(poll, COMMAND_GROUP_PROBE_INTERVAL_MS);
  };
  const escalateGroupTermination = () => {
    if (settled || terminationError || groupTerminationVerified || escalationStarted) return;
    groupTerminationRequired = true;
    escalationStarted = true;
    if (forceKillTimer) clearTimeout(forceKillTimer);
    forceKillTimer = null;
    let signaled;
    try {
      signaled = signalCommand("SIGKILL");
    } catch (error) {
      recordTerminationError(error);
      return;
    }
    if (!signaled) {
      markGroupTerminationVerified();
      return;
    }
    if (processGroupId === null) {
      if (childClose !== null) markGroupTerminationVerified();
      return;
    }
    pollForGroupTermination();
  };
  const requireGroupTermination = (signal) => {
    if (settled || terminationError || groupTerminationVerified) return;
    const alreadyRequired = groupTerminationRequired;
    groupTerminationRequired = true;
    if (signal === "SIGKILL") {
      escalateGroupTermination();
      return;
    }
    if (alreadyRequired) return;
    let signaled;
    try {
      signaled = signalCommand(signal);
    } catch (error) {
      recordTerminationError(error);
      return;
    }
    if (!signaled) {
      markGroupTerminationVerified();
      return;
    }
    forceKillTimer = setTimeout(() => {
      forceKillTimer = null;
      escalateGroupTermination();
    }, options.terminationGraceMs);
  };
  child.stdout.on("data", (chunk) => {
    stdoutBytes += chunk.length;
    stdoutChunks.push(chunk);
    if (stdoutBytes > options.maxBuffer && !streamError) {
      streamError = new Error(`Gate B command ${command} exceeded the stdout buffer limit`);
      requireGroupTermination(options.killSignal);
    }
  });
  child.stderr.on("data", (chunk) => {
    stderrBytes += chunk.length;
    stderrChunks.push(chunk);
    if (stderrBytes > options.maxBuffer && !streamError) {
      streamError = new Error(`Gate B command ${command} exceeded the stderr buffer limit`);
      requireGroupTermination(options.killSignal);
    }
  });
  child.once("error", (error) => {
    spawnError = error;
  });
  const timeoutTimer = options.timeout === undefined ? null : setTimeout(() => {
    timeoutError = new Error(`Gate B command ${command} timed out after ${options.timeout}ms`);
    timeoutError.code = "ETIMEDOUT";
    timeoutError.killed = true;
    timeoutError.signal = options.killSignal;
    requireGroupTermination(options.killSignal);
  }, options.timeout);
  timeoutTimer?.unref();

  const promise = new Promise((resolveExecution, rejectExecution) => {
    settleExecution = () => {
      if (settled) return;
      if (!terminationError && (childClose === null || (groupTerminationRequired && !groupTerminationVerified))) return;
      settled = true;
      const { code = null, signal = null } = childClose ?? {};
      clearTerminationTimers();
      if (timeoutTimer) clearTimeout(timeoutTimer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      const error = terminationError ?? spawnError ?? streamError ?? timeoutError ?? abortReason
        ?? (code === 0 ? null : commandExitError(command, code, signal));
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        error.code ??= code;
        error.signal ??= signal;
        error.killed ??= signal !== null;
        rejectExecution(error);
        return;
      }
      resolveExecution({ stdout, stderr });
    };
    child.once("close", (code, signal) => {
      childClose = { code, signal };
      if (groupTerminationRequired && !terminationError && !groupTerminationVerified) {
        if (processGroupId === null) {
          markGroupTerminationVerified();
          return;
        }
        let terminated;
        try {
          terminated = verifyProcessGroup();
        } catch (error) {
          recordTerminationError(error);
          return;
        }
        if (terminated) {
          markGroupTerminationVerified();
          return;
        }
        escalateGroupTermination();
      }
      settleExecution();
    });
  });
  const control = {
    abort(reason) {
      if (abortReason || settled) return;
      abortReason = reason instanceof Error ? reason : new Error(String(reason));
      if (timeoutTimer) clearTimeout(timeoutTimer);
      requireGroupTermination("SIGTERM");
    }
  };
  return { promise, control };
}

function commandExitError(command, code, signal) {
  const exit = signal ? `signal ${signal}` : `code ${code}`;
  const error = new Error(`Gate B command ${command} exited with ${exit}`);
  error.code = code;
  error.signal = signal;
  error.killed = signal !== null;
  return error;
}

function signalChildProcessGroup(child, processGroupId, signal, processKill) {
  if (processGroupId !== null) {
    try {
      processKill(-processGroupId, signal);
      return true;
    } catch (error) {
      if (error?.code === "ESRCH") return false;
      throw error;
    }
  }
  if (child.exitCode !== null || child.signalCode !== null) return false;
  try {
    child.kill(signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

function processGroupExists(processGroupId, processKill) {
  try {
    processKill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

function commandTerminationError(command, processGroupId, action, cause, options = {}) {
  const target = processGroupId === null ? "process" : `group ${processGroupId}`;
  return new GateBCommandTerminationError(
    `Gate B could not ${action} command ${target}: ${cause instanceof Error ? cause.message : String(cause)}`,
    {
      cause,
      code: cause?.code,
      signal: options.signal,
      killed: false
    }
  );
}

export function runPostgresCommand(command, args, options = {}) {
  const hardenedArgs = command === "psql" && !args.includes("--no-psqlrc")
    ? ["--no-psqlrc", ...args]
    : args;
  return run(command, hardenedArgs, postgresPasswordEnvironment(), options);
}

async function canonicalOwnedSequences(client) {
  const discovered = await client.query(`
    select sequence_namespace.nspname as schema_name,
           sequence_relation.relname as sequence_name,
           table_relation.relname as table_name,
           table_attribute.attname as column_name,
           sequence_parameters.seqstart::text as start_value,
           sequence_parameters.seqincrement::text as increment_by,
           sequence_parameters.seqmax::text as max_value,
           sequence_parameters.seqmin::text as min_value,
           sequence_parameters.seqcache::text as cache_size,
           sequence_parameters.seqcycle as cycle,
           format_type(sequence_parameters.seqtypid, null) as data_type
      from pg_class sequence_relation
      join pg_namespace sequence_namespace on sequence_namespace.oid = sequence_relation.relnamespace
      join pg_sequence sequence_parameters on sequence_parameters.seqrelid = sequence_relation.oid
      join pg_depend dependency
        on dependency.classid = 'pg_class'::regclass
       and dependency.objid = sequence_relation.oid
       and dependency.objsubid = 0
       and dependency.refclassid = 'pg_class'::regclass
       and dependency.deptype in ('a', 'i')
      join pg_class table_relation on table_relation.oid = dependency.refobjid
      join pg_attribute table_attribute
        on table_attribute.attrelid = dependency.refobjid
       and table_attribute.attnum = dependency.refobjsubid
     where sequence_relation.relkind = 'S'
       and sequence_namespace.nspname = current_schema()
     order by sequence_relation.relname, table_relation.relname, table_attribute.attname
  `);
  const sequences = {};
  for (const row of discovered.rows) {
    activeSignalContext?.throwIfInterrupted();
    const result = await client.query(
      `select last_value::text as last_value, is_called from ${quoteIdentifier(row.schema_name)}.${quoteIdentifier(row.sequence_name)}`
    );
    assert.equal(result.rows.length, 1, `owned sequence ${row.sequence_name} must expose one state row`);
    sequences[`${row.schema_name}.${row.sequence_name}`] = {
      ownedBy: `${row.table_name}.${row.column_name}`,
      qualifiedName: `${quoteIdentifier(row.schema_name)}.${quoteIdentifier(row.sequence_name)}`,
      dataType: row.data_type,
      startValue: row.start_value,
      incrementBy: row.increment_by,
      minValue: row.min_value,
      maxValue: row.max_value,
      cacheSize: row.cache_size,
      cycle: row.cycle,
      lastValue: result.rows[0].last_value,
      isCalled: result.rows[0].is_called
    };
  }
  return sequences;
}

export function assertMatchingSequenceStates(sourceSequences, restoredSequences) {
  assert.deepEqual(
    restoredSequences,
    sourceSequences,
    "restored PostgreSQL owned sequence definitions and state must exactly match the source database"
  );
}

export function assertMatchingNextSequenceValue(sequenceName, sourceValue, restoredValue) {
  assert.equal(
    restoredValue,
    sourceValue,
    `restored PostgreSQL owned sequence ${sequenceName} must return the same nextval as the source database`
  );
}

async function proveOwnedSequenceNextValueContinuity({ sourceDatabaseUrl, restoredDatabaseUrl, ownedSequences }) {
  const sourcePool = localPool(sourceDatabaseUrl);
  const restoredPool = localPool(restoredDatabaseUrl);
  const nextValues = {};
  try {
    for (const [sequenceName, sequence] of Object.entries(ownedSequences)) {
      activeSignalContext?.throwIfInterrupted();
      assert.equal(typeof sequence.qualifiedName, "string", `owned sequence ${sequenceName} must have a qualified name`);
      const [sourceResult, restoredResult] = await Promise.all([
        sourcePool.query("select nextval($1::regclass)::text as next_value", [sequence.qualifiedName]),
        restoredPool.query("select nextval($1::regclass)::text as next_value", [sequence.qualifiedName])
      ]);
      assert.equal(sourceResult.rows.length, 1, `source owned sequence ${sequenceName} must return one nextval row`);
      assert.equal(restoredResult.rows.length, 1, `restored owned sequence ${sequenceName} must return one nextval row`);
      const sourceValue = sourceResult.rows[0].next_value;
      const restoredValue = restoredResult.rows[0].next_value;
      assertMatchingNextSequenceValue(sequenceName, sourceValue, restoredValue);
      nextValues[sequenceName] = sourceValue;
    }
  } finally {
    await Promise.all([sourcePool.end(), restoredPool.end()]);
  }
  return {
    sequenceCount: Object.keys(nextValues).length,
    nextValuesSha256: sha256(JSON.stringify(nextValues))
  };
}

function localPool(connectionString) {
  return new Pool({
    connectionString,
    max: 1,
    ssl: false,
    connectionTimeoutMillis: CLEANUP_COMMAND_TIMEOUT_MS,
    query_timeout: CLEANUP_COMMAND_TIMEOUT_MS,
    statement_timeout: CLEANUP_COMMAND_TIMEOUT_MS
  });
}

function localDatabaseUrl(databaseName) {
  assert(/^[a-zA-Z0-9._-]+$/.test(postgresEndpoint.user), "Gate B PostgreSQL user must be a local account name");
  assert(/^[a-z][a-z0-9_]+$/.test(databaseName), "Gate B PostgreSQL database name is unsafe");
  const host = postgresEndpoint.host === "::1" ? "[::1]" : postgresEndpoint.host;
  const password = postgresEndpoint.password.length > 0 ? `:${encodeURIComponent(postgresEndpoint.password)}` : "";
  return `postgresql://${encodeURIComponent(postgresEndpoint.user)}${password}@${host}:${postgresEndpoint.port}/${databaseName}`;
}

function postgresCliConnectionArgs() {
  return [
    "--host", postgresEndpoint.host,
    "--port", postgresEndpoint.port,
    "--username", postgresEndpoint.user
  ];
}

function commandEnvironment(extraEnvironment) {
  const inherited = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => name !== "DATABASE_URL" && !name.startsWith("PG")));
  const environment = { ...inherited, ...extraEnvironment };
  delete environment.PSQLRC;
  return environment;
}

function postgresPasswordEnvironment() {
  return postgresEndpoint.password.length > 0 ? { PGPASSWORD: postgresEndpoint.password } : {};
}

function quoteIdentifier(value) {
  assert.equal(typeof value, "string", "PostgreSQL identifier must be a string");
  return `"${value.replaceAll('"', '""')}"`;
}

export function resolveLocalPostgresEndpoint(environment = {}, defaultUser = userInfo().username) {
  assert(environment && typeof environment === "object", "PostgreSQL environment must be an object");
  for (const name of ["PGSERVICE", "PGSERVICEFILE"]) {
    if (nonEmptyEnvironmentValue(environment, name) !== null) {
      throw new Error(`${name} is forbidden for Gate B because a service can hide a non-loopback PostgreSQL endpoint`);
    }
  }
  if (nonEmptyEnvironmentValue(environment, "PGHOSTADDR") !== null) {
    throw new Error("PGHOSTADDR is forbidden for Gate B because it can override the verified PostgreSQL host");
  }

  const databaseUrlValue = nonEmptyEnvironmentValue(environment, "DATABASE_URL");
  const urlEndpoint = databaseUrlValue === null ? null : parsePostgresUrlEndpoint(databaseUrlValue);
  const environmentHost = normalizeOptionalHost(nonEmptyEnvironmentValue(environment, "PGHOST"), "PGHOST");
  const environmentPort = normalizeOptionalPort(nonEmptyEnvironmentValue(environment, "PGPORT"), "PGPORT");
  const environmentUser = normalizeOptionalUser(nonEmptyEnvironmentValue(environment, "PGUSER"), "PGUSER");
  const environmentPassword = nonEmptyEnvironmentValue(environment, "PGPASSWORD");

  assertNoEndpointConflict("host", urlEndpoint?.host, environmentHost);
  assertNoEndpointConflict("port", urlEndpoint?.port, environmentPort);
  assertNoEndpointConflict("user", urlEndpoint?.user, environmentUser);
  assertNoEndpointConflict("password", urlEndpoint?.password || null, environmentPassword);

  const host = urlEndpoint?.host ?? environmentHost ?? "127.0.0.1";
  const port = urlEndpoint?.port ?? environmentPort ?? "5432";
  const user = urlEndpoint?.user ?? environmentUser ?? normalizeRequiredUser(defaultUser, "local operating-system user");
  const password = urlEndpoint?.password ?? environmentPassword ?? "";
  assertLoopbackHost(host, "resolved PostgreSQL host");
  normalizeRequiredPort(port, "resolved PostgreSQL port");
  normalizeRequiredUser(user, "resolved PostgreSQL user");
  return Object.freeze({ host, port, user, password });
}

function parsePostgresUrlEndpoint(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    throw new Error("DATABASE_URL must use the postgres or postgresql scheme");
  }
  if (parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new Error("DATABASE_URL query parameters and fragments are forbidden for Gate B endpoint verification");
  }
  const host = normalizeRequiredHost(parsed.hostname, "DATABASE_URL host");
  const port = normalizeRequiredPort(parsed.port || "5432", "DATABASE_URL port");
  const user = parsed.username.length > 0
    ? normalizeRequiredUser(decodeUrlComponent(parsed.username, "DATABASE_URL user"), "DATABASE_URL user")
    : null;
  const password = parsed.password.length > 0
    ? decodeUrlComponent(parsed.password, "DATABASE_URL password")
    : null;
  return { host, port, user, password };
}

function normalizeOptionalHost(value, label) {
  return value === null ? null : normalizeRequiredHost(value, label);
}

function normalizeRequiredHost(value, label) {
  const normalized = String(value).trim().replace(/^\[(.*)\]$/, "$1").toLowerCase();
  if (normalized.includes(",")) throw new Error(`${label} must identify exactly one PostgreSQL host`);
  assertLoopbackHost(normalized, label);
  return normalized;
}

function assertLoopbackHost(value, label) {
  if (!new Set(["127.0.0.1", "::1", "localhost"]).has(value)) {
    throw new Error(`${label} must be exactly 127.0.0.1, ::1, or localhost`);
  }
}

function normalizeOptionalPort(value, label) {
  return value === null ? null : normalizeRequiredPort(value, label);
}

function normalizeRequiredPort(value, label) {
  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) throw new Error(`${label} must be a decimal TCP port`);
  const numeric = Number(normalized);
  if (!Number.isSafeInteger(numeric) || numeric < 1 || numeric > 65_535) {
    throw new Error(`${label} must be between 1 and 65535`);
  }
  return String(numeric);
}

function normalizeOptionalUser(value, label) {
  return value === null ? null : normalizeRequiredUser(value, label);
}

function normalizeRequiredUser(value, label) {
  const normalized = String(value).trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(normalized)) throw new Error(`${label} is not a safe local PostgreSQL user`);
  return normalized;
}

function assertNoEndpointConflict(field, urlValue, environmentValue) {
  if (urlValue !== null && urlValue !== undefined && environmentValue !== null && urlValue !== environmentValue) {
    throw new Error(`DATABASE_URL and PG* ${field} values conflict`);
  }
}

function nonEmptyEnvironmentValue(environment, name) {
  const value = environment[name];
  if (value === undefined || value === null || String(value).trim().length === 0) return null;
  return String(value);
}

function decodeUrlComponent(value, label) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`${label} contains invalid percent encoding`);
  }
}

export function createGateBSignalContext({
  processTarget = process,
  onSignal = (signal) => console.error(`Gate B received ${signal}; stopping the active local command before bounded cleanup.`)
} = {}) {
  assert.equal(typeof processTarget?.on, "function", "signal process target must expose on()");
  assert.equal(typeof processTarget?.off, "function", "signal process target must expose off()");
  assert.equal(typeof onSignal, "function", "signal reporter must be a function");
  let interruptedSignal = null;
  let activeCommand = null;
  let handlers = [];
  return {
    get interruptedSignal() {
      return interruptedSignal;
    },
    install() {
      assert.equal(handlers.length, 0, "Gate B signal handlers are already installed");
      handlers = ["SIGINT", "SIGTERM"].map((signal) => {
        const handler = () => {
          if (interruptedSignal) return;
          interruptedSignal = signal;
          onSignal(signal);
          activeCommand?.abort(new GateBInterruptedError(signal));
        };
        processTarget.on(signal, handler);
        return [signal, handler];
      });
    },
    remove() {
      for (const [signal, handler] of handlers) processTarget.off(signal, handler);
      handlers = [];
    },
    activateCommand(commandControl) {
      if (commandControl === null) return;
      assert.equal(typeof commandControl?.abort, "function", "active Gate B command requires an abort control");
      assert.equal(activeCommand, null, "Gate B commands must execute sequentially");
      activeCommand = commandControl;
      if (interruptedSignal) activeCommand.abort(new GateBInterruptedError(interruptedSignal));
    },
    deactivateCommand(commandControl) {
      if (commandControl !== null && activeCommand === commandControl) activeCommand = null;
    },
    throwIfInterrupted() {
      if (interruptedSignal) throw new GateBInterruptedError(interruptedSignal);
    }
  };
}

export async function executeWithGateBSignalCleanup({
  execute,
  cleanup,
  processTarget = process,
  onSignal
}) {
  assert.equal(typeof execute, "function", "Gate B execution function is required");
  assert.equal(typeof cleanup, "function", "Gate B cleanup function is required");
  assert.equal(activeSignalContext, null, "Gate B signal lifecycle cannot be nested");
  const signalContext = createGateBSignalContext({ processTarget, onSignal });
  signalContext.install();
  activeSignalContext = signalContext;
  let operationError;
  let cleanupErrors = [];
  try {
    try {
      await execute(signalContext);
    } catch (error) {
      operationError = signalContext.interruptedSignal
        && !(error instanceof GateBInterruptedError)
        && !(error instanceof GateBCommandTerminationError)
        ? new GateBInterruptedError(signalContext.interruptedSignal, { cause: error })
        : error;
    }
    try {
      const result = await cleanup(signalContext);
      assert(Array.isArray(result), "Gate B cleanup must return an error array");
      cleanupErrors = result;
    } catch (error) {
      cleanupErrors = [error instanceof Error ? error : new Error(String(error))];
    }
  } finally {
    activeSignalContext = null;
    signalContext.remove();
  }

  if (signalContext.interruptedSignal && !operationError) {
    operationError = new GateBInterruptedError(signalContext.interruptedSignal);
  }
  if (operationError instanceof GateBInterruptedError && cleanupErrors.length === 0) {
    return { interruptedSignal: operationError.signal };
  }
  if (operationError && cleanupErrors.length > 0) {
    throw new AggregateError([operationError, ...cleanupErrors], "Gate B verification and cleanup both failed");
  }
  if (operationError) throw operationError;
  if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, "Gate B cleanup failed");
  return { interruptedSignal: null };
}
