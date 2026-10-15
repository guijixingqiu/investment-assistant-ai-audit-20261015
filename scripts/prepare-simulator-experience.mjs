#!/usr/bin/env node
// Owner-authorised, local-only helper: build ONE isolated Simulator experience copy of the
// current public research so a labelled sample run can never write the ordinary local profile.
//
// It only ever creates: one new ias_experience_* database and one new external raw store.
// It never drops, truncates or overwrites anything that already exists, and it never writes the
// source database or the source raw store: the copy lands in the new destination only. Connection
// details reach psql/pg_dump/pg_restore through the standard PG* environment variables, so no
// credential is printed, logged or committed.
//
// Usage (the controller runs this; this implementation task does not):
//   node scripts/prepare-simulator-experience.mjs \
//     --source-database-url postgres://localhost/ias_normal \
//     --destination-database-url postgres://localhost/ias_experience_20260914 \
//     --source-raw-root "$LOCAL_ALPHA_RAW_STORE_ROOT" \
//     --destination-raw-root "$HOME/.annualrings/experience-raw-20260914"
//
// Environment fallbacks: LOCAL_ALPHA_SOURCE_DATABASE_URL, LOCAL_ALPHA_EXPERIENCE_DATABASE_URL,
// LOCAL_ALPHA_SOURCE_RAW_STORE_ROOT, LOCAL_ALPHA_EXPERIENCE_RAW_STORE_ROOT.
//
// Offline validation of the isolation rules (no database connection, no write):
//   node scripts/prepare-simulator-experience.mjs --self-check
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repositoryRoot = process.cwd();
const destinationDatabasePrefix = "ias_experience_";
const destinationDatabaseNamePattern = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const loopbackHosts = ["", "localhost", "127.0.0.1", "::1", "[::1]"];

export function parsePostgresTarget(rawValue, label) {
  if (!rawValue) throw new Error(`${label} is required`);
  let url;
  try {
    url = new URL(rawValue);
  } catch {
    throw new Error(`${label} is not a valid PostgreSQL URL`);
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error(`${label} must be a postgres or postgresql URL`);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database || database.includes("/")) throw new Error(`${label} must name exactly one database`);
  const socketHost = url.searchParams.get("host");
  if (!loopbackHosts.includes(url.hostname)) throw new Error(`${label} must point at loopback or local-socket PostgreSQL`);
  if (socketHost !== null && !socketHost.startsWith("/")) {
    throw new Error(`${label} socket host must be an absolute local socket directory`);
  }
  if (!url.hostname && !socketHost) {
    throw new Error(`${label} must name a loopback host or an absolute local socket directory`);
  }
  return {
    database,
    hostname: url.hostname === "[::1]" ? "::1" : url.hostname,
    port: url.port,
    user: url.username ? decodeURIComponent(url.username) : "",
    password: url.password ? decodeURIComponent(url.password) : "",
    socketHost: socketHost ?? "",
    sslmode: url.searchParams.get("sslmode") ?? "disable"
  };
}

/// Pure path/name isolation rules. It never opens a database connection and never creates or
/// changes anything, so `--self-check` can prove the rejections without touching real data.
export function validateIsolation(options, repository = repositoryRoot) {
  const source = parsePostgresTarget(options.sourceDatabaseUrl, "--source-database-url");
  const destination = parsePostgresTarget(options.destinationDatabaseUrl, "--destination-database-url");
  if (source.database === destination.database) {
    throw new Error("source and destination databases must be different");
  }
  if (!destinationDatabaseNamePattern.test(destination.database)) {
    throw new Error("destination database name must be a plain PostgreSQL identifier");
  }
  if (!destination.database.startsWith(destinationDatabasePrefix)) {
    throw new Error(`destination database name must start with ${destinationDatabasePrefix}`);
  }
  const sourceRawRoot = requireExternalPath(options.sourceRawRoot, "--source-raw-root", repository);
  const destinationRawRoot = requireExternalPath(options.destinationRawRoot, "--destination-raw-root", repository);
  if (sourceRawRoot === destinationRawRoot) {
    throw new Error("source and destination raw stores must be different");
  }
  if (!isOutside(sourceRawRoot, destinationRawRoot) || !isOutside(destinationRawRoot, sourceRawRoot)) {
    throw new Error("source and destination raw stores must not be nested inside each other");
  }
  return { source, destination, sourceRawRoot, destinationRawRoot };
}

function requireExternalPath(rawValue, label, repository) {
  if (!rawValue || !path.isAbsolute(rawValue)) throw new Error(`${label} must be an absolute path`);
  const resolved = resolveExistingAncestors(rawValue);
  if (!isOutside(resolveExistingAncestors(repository), resolved)) throw new Error(`${label} must be outside the repository`);
  return resolved;
}

/// A symlinked parent can alias another directory, so the checks run on the path reached through the
/// deepest ancestor that already exists; only a not-yet-created tail keeps its plain spelling.
function resolveExistingAncestors(rawValue) {
  let existing = path.resolve(rawValue);
  const missing = [];
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  if (!existsSync(existing)) return path.resolve(rawValue);
  const real = realpathSync(existing);
  return missing.length ? path.join(real, ...missing) : real;
}

function isOutside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== "" && (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative));
}

function postgresEnvironment(target) {
  const environment = { ...process.env, PGDATABASE: target.database, PGSSLMODE: target.sslmode, PGCONNECT_TIMEOUT: "10" };
  environment.PGHOST = target.socketHost || target.hostname || "127.0.0.1";
  if (target.port) environment.PGPORT = target.port;
  if (target.user) environment.PGUSER = target.user;
  if (target.password) environment.PGPASSWORD = target.password;
  return environment;
}

function redact(text, secrets) {
  let output = String(text ?? "");
  for (const secret of secrets) {
    if (secret) output = output.split(secret).join("***");
  }
  return output.replace(/(postgres(?:ql)?:\/\/[^:@/\s]+:)[^@/\s]+(@)/g, "$1***$2");
}

class StageFailure extends Error {
  constructor(label, detail) {
    super(detail ? `${label}: ${detail}` : label);
    this.label = label;
    this.detail = detail ?? "";
  }
}

function failStage(label, detail) {
  throw new StageFailure(label, detail);
}

function reportFailure(error, plan, destinationTouched) {
  if (error instanceof StageFailure) {
    console.error(`failed: ${error.label}${error.detail ? ` (${error.detail})` : ""}`);
  } else {
    console.error(`failed: unexpected (${error instanceof Error ? error.message : "unknown error"})`);
  }
  console.error(`The source database ${plan.source.database} and the source raw store were not modified.`);
  if (destinationTouched) {
    console.error(`${plan.destination.database} and ${plan.destinationRawRoot} may hold an incomplete copy; nothing was dropped or overwritten and the incomplete destination was kept for inspection.`);
  } else {
    console.error("No destination database or raw store was created.");
  }
}

function runStage(label, command, args, environment, secrets) {
  const result = spawnSync(command, args, { env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) failStage(label, redact(result.error.code ?? result.error.message, secrets));
  if (result.status !== 0) {
    failStage(label, redact(`${result.stderr || result.stdout || ""}`.trim().slice(-300), secrets));
  }
  console.log(`ok: ${label}`);
}

function requireExistingSourceRawStore(directory) {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    failStage("source-raw-store-readable", "--source-raw-root must be an existing directory");
  }
  console.log("ok: source-raw-store-readable");
}

function requireAbsentDestination(plan, secrets) {
  if (existsSync(plan.destinationRawRoot)) {
    failStage("destination-raw-store-absent", "destination raw store already exists");
  }
  // The destination must not exist yet, so the existence check runs through the always-present
  // maintenance database instead of connecting to the destination itself.
  const environment = { ...postgresEnvironment(plan.destination), PGDATABASE: "postgres" };
  const result = spawnSync("psql", [
    "--tuples-only", "--no-align",
    "--command", `select 1 from pg_database where datname = '${plan.destination.database}'`
  ], { env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) failStage("destination-database-absent", redact(result.error.code ?? result.error.message, secrets));
  if (result.status !== 0) {
    failStage("destination-database-absent", redact(`${result.stderr ?? ""}`.trim().slice(-300), secrets));
  }
  if (result.stdout.trim() !== "") {
    failStage("destination-database-absent", "destination database already exists");
  }
  console.log("ok: destination-absent");
}

function copyRawStore(source, destination) {
  // The destination must be absent, so this only ever creates a new directory tree next to it.
  try {
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(source, destination, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
  } catch (error) {
    failStage("copy-raw-store", error instanceof Error ? error.message : "raw store copy failed");
  }
  console.log("ok: copy-raw-store");
}

function planFromArguments(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`unexpected argument ${key ?? ""}`);
    args[key.slice(2)] = value;
  }
  return {
    sourceDatabaseUrl: args["source-database-url"] ?? process.env.LOCAL_ALPHA_SOURCE_DATABASE_URL,
    destinationDatabaseUrl: args["destination-database-url"] ?? process.env.LOCAL_ALPHA_EXPERIENCE_DATABASE_URL,
    sourceRawRoot: args["source-raw-root"] ?? process.env.LOCAL_ALPHA_SOURCE_RAW_STORE_ROOT,
    destinationRawRoot: args["destination-raw-root"] ?? process.env.LOCAL_ALPHA_EXPERIENCE_RAW_STORE_ROOT
  };
}

function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("usage: node scripts/prepare-simulator-experience.mjs --source-database-url <url> --destination-database-url <url> --source-raw-root <dir> --destination-raw-root <dir>");
    return 0;
  }
  if (argv.includes("--self-check")) return selfCheck();
  let plan;
  try {
    plan = validateIsolation(planFromArguments(argv), repositoryRoot);
  } catch (error) {
    console.error(`failed: validate-arguments (${error instanceof Error ? error.message : "invalid arguments"})`);
    return 1;
  }
  const secrets = [plan.source.password, plan.destination.password];
  const dumpDirectory = mkdtempSync(path.join(tmpdir(), "ias-experience-dump-"));
  const dumpPath = path.join(dumpDirectory, "source.dump");
  let destinationTouched = false;
  try {
    requireExistingSourceRawStore(plan.sourceRawRoot);
    requireAbsentDestination(plan, secrets);
    runStage("create-destination-database", "createdb",
      ["--encoding=UTF8", "--template=template0", plan.destination.database],
      postgresEnvironment(plan.destination), secrets);
    destinationTouched = true;
    runStage("dump-source", "pg_dump",
      ["--format=custom", "--no-owner", "--no-privileges", "--file", dumpPath],
      postgresEnvironment(plan.source), secrets);
    runStage("restore-destination", "pg_restore",
      ["--no-owner", "--no-privileges", "--exit-on-error", "--dbname", plan.destination.database, dumpPath],
      postgresEnvironment(plan.destination), secrets);
    copyRawStore(plan.sourceRawRoot, plan.destinationRawRoot);
  } catch (error) {
    // The temporary dump can hold source data, so it is removed before the failure is reported.
    rmSync(dumpDirectory, { recursive: true, force: true });
    reportFailure(error, plan, destinationTouched);
    return 1;
  }
  rmSync(dumpDirectory, { recursive: true, force: true });
  console.log(`${plan.destination.database} now holds a copy of ${plan.source.database}.`);
  console.log("The clone keeps whatever the source held, including private personal facts; it is isolated, not narrowed. Use a narrower source later if that is not wanted.");
  console.log("SUCCESS");
  return 0;
}

export function selfCheck() {
  const base = {
    sourceDatabaseUrl: "postgres://127.0.0.1:5432/ias_normal_research",
    destinationDatabaseUrl: "postgres://127.0.0.1:5432/ias_experience_20260914",
    sourceRawRoot: "/tmp/ias-experience-self-check-source-raw",
    destinationRawRoot: "/tmp/ias-experience-self-check-destination-raw"
  };
  const expectedFailures = [
    ["equal database", { destinationDatabaseUrl: base.sourceDatabaseUrl }, /databases must be different/],
    ["destination outside the experience prefix", { destinationDatabaseUrl: "postgres://127.0.0.1:5432/ias_normal_clone" }, /ias_experience_/],
    ["remote database", { sourceDatabaseUrl: "postgres://db.example.com/ias_normal_research" }, /loopback/],
    ["non-absolute socket host", { sourceDatabaseUrl: "postgres://localhost/ias_normal_research?host=db.example.com" }, /socket host must be an absolute local socket directory/],
    ["equal raw roots", { destinationRawRoot: base.sourceRawRoot }, /raw stores must be different/],
    ["nested raw roots", { destinationRawRoot: `${base.sourceRawRoot}/nested` }, /must not be nested/],
    ["nested repository raw root", { destinationRawRoot: path.join(repositoryRoot, "artifacts/experience-raw") }, /outside the repository/]
  ];
  let failures = 0;
  for (const [name, override, expected] of expectedFailures) {
    let message = "";
    try {
      validateIsolation({ ...base, ...override }, repositoryRoot);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    const rejected = expected.test(message);
    if (!rejected) failures += 1;
    console.log(`${rejected ? "ok" : "FAILED"}: reject ${name}${rejected ? "" : ` (got: ${message || "no error"})`}`);
  }
  try {
    const plan = validateIsolation(base, repositoryRoot);
    console.log(`ok: accept isolated pair ${plan.source.database} -> ${plan.destination.database}`);
  } catch (error) {
    failures += 1;
    console.log(`FAILED: accept isolated pair (${error instanceof Error ? error.message : "unexpected error"})`);
  }
  console.log(failures === 0 ? "SELF-CHECK PASS" : "SELF-CHECK FAIL");
  return failures === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
