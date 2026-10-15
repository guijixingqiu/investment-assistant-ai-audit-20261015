import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";

export const DEFAULT_LOCK_ROOT =
  "/Users/REDACTED/.codex/automations/investment-stage-runner";
export const LOCK_DIRECTORY_NAME = "single-instance.lock";
export const LOCK_METADATA_FILE_NAME = "metadata.json";
export const LOCK_OWNER_TOKEN_VERIFIER_FILE_NAME = "owner-token-verifier";

function lockPaths(lockRoot = DEFAULT_LOCK_ROOT) {
  const lockDir = join(lockRoot, LOCK_DIRECTORY_NAME);
  return {
    lockRoot,
    lockDir,
    metadataPath: join(lockDir, LOCK_METADATA_FILE_NAME),
    ownerTokenVerifierPath: join(lockDir, LOCK_OWNER_TOKEN_VERIFIER_FILE_NAME),
  };
}

function buildOwnerTokenVerifier(ownerToken) {
  return createHash("sha256").update(ownerToken).digest("hex");
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function readTextIfPresent(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readJsonIfPresent(path) {
  const text = await readTextIfPresent(path);
  if (text === null) {
    return { value: null, error: null };
  }
  try {
    return {
      value: JSON.parse(text),
      error: null,
    };
  } catch (error) {
    return {
      value: null,
      error: {
        code: "invalid_metadata_json",
        message: error.message,
      },
    };
  }
}

function buildMetadata(lockRoot, acquiredAt) {
  return {
    lockRoot,
    acquiredAt,
    pid: process.pid,
    ppid: process.ppid,
    hostname: hostname(),
    platform: process.platform,
    nodeVersion: process.version,
    cwd: process.cwd(),
  };
}

export async function readStageRunLockStatus({
  lockRoot = DEFAULT_LOCK_ROOT,
} = {}) {
  const paths = lockPaths(lockRoot);
  const locked = await exists(paths.lockDir);
  if (!locked) {
    return {
      ok: true,
      locked: false,
      lockRoot: paths.lockRoot,
      lockDir: paths.lockDir,
      metadata: null,
      metadataError: null,
      hasOwnerTokenVerifier: false,
      incomplete: false,
    };
  }

  const metadataResult = await readJsonIfPresent(paths.metadataPath);
  const hasOwnerTokenVerifier = await exists(paths.ownerTokenVerifierPath);

  return {
    ok: true,
    locked: true,
    lockRoot: paths.lockRoot,
    lockDir: paths.lockDir,
    metadata: metadataResult.value,
    metadataError: metadataResult.error,
    hasOwnerTokenVerifier,
    incomplete: metadataResult.value === null || !hasOwnerTokenVerifier,
  };
}

export async function acquireStageRunLock({
  lockRoot = DEFAULT_LOCK_ROOT,
  acquiredAt = new Date().toISOString(),
  randomBytesImpl = randomBytes,
} = {}) {
  const paths = lockPaths(lockRoot);
  await mkdir(paths.lockRoot, { recursive: true });

  try {
    await mkdir(paths.lockDir, { mode: 0o700 });
  } catch (error) {
    if (error && error.code === "EEXIST") {
      return {
        ok: true,
        acquired: false,
        reason: "busy",
        ...(await readStageRunLockStatus({ lockRoot })),
      };
    }
    throw error;
  }

  const ownerToken = randomBytesImpl(32).toString("hex");
  const ownerTokenVerifier = buildOwnerTokenVerifier(ownerToken);
  const metadata = buildMetadata(paths.lockRoot, acquiredAt);

  try {
    await writeFile(paths.ownerTokenVerifierPath, `${ownerTokenVerifier}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(paths.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    throw new Error(
      `Lock acquired but initialization failed; leave lock in place for fail-closed inspection: ${error.message}`
    );
  }

  return {
    ok: true,
    acquired: true,
    lockRoot: paths.lockRoot,
    lockDir: paths.lockDir,
    ownerToken,
    metadata,
  };
}

export async function releaseStageRunLock({
  lockRoot = DEFAULT_LOCK_ROOT,
  ownerToken,
} = {}) {
  const paths = lockPaths(lockRoot);
  const status = await readStageRunLockStatus({ lockRoot });
  if (!status.locked) {
    return {
      ...status,
      ok: false,
      released: false,
      reason: "not_locked",
    };
  }

  if (typeof ownerToken !== "string" || ownerToken.trim().length === 0) {
    return {
      ...status,
      ok: false,
      released: false,
      reason: "owner_token_required",
    };
  }

  const storedOwnerTokenVerifier = await readTextIfPresent(
    paths.ownerTokenVerifierPath
  );
  if (storedOwnerTokenVerifier === null) {
    return {
      ...status,
      ok: false,
      released: false,
      reason: "owner_token_missing",
    };
  }

  const expectedVerifier = buildOwnerTokenVerifier(ownerToken.trim());
  if (storedOwnerTokenVerifier.trim() !== expectedVerifier) {
    return {
      ...status,
      ok: false,
      released: false,
      reason: "owner_token_mismatch",
    };
  }

  await rm(paths.lockDir, { recursive: true, force: false });
  return {
    ok: true,
    released: true,
    lockRoot: paths.lockRoot,
    lockDir: paths.lockDir,
  };
}

export async function forceReleaseStageRunLock({
  lockRoot = DEFAULT_LOCK_ROOT,
  confirmStaleLock = false,
  reason,
} = {}) {
  const status = await readStageRunLockStatus({ lockRoot });
  if (!status.locked) {
    return {
      ...status,
      ok: false,
      forced: false,
      reason: "not_locked",
    };
  }

  if (!confirmStaleLock) {
    return {
      ...status,
      ok: false,
      forced: false,
      reason: "explicit_confirmation_required",
    };
  }

  if (typeof reason !== "string" || reason.trim().length === 0) {
    return {
      ...status,
      ok: false,
      forced: false,
      reason: "reason_required",
    };
  }

  const paths = lockPaths(lockRoot);
  await rm(paths.lockDir, { recursive: true, force: false });
  return {
    ok: true,
    forced: true,
    lockRoot: paths.lockRoot,
    lockDir: paths.lockDir,
    removalReason: reason,
    previousStatus: status,
  };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {
    command,
    lockRoot: DEFAULT_LOCK_ROOT,
    ownerToken: undefined,
    reason: undefined,
    confirmStaleLock: false,
    json: false,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--lock-root") {
      options.lockRoot = rest[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--owner-token") {
      options.ownerToken = rest[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--reason") {
      options.reason = rest[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--confirm-stale-lock") {
      options.confirmStaleLock = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.command = "help";
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/codex-stage-run-lock.mjs acquire [--lock-root <path>] [--json]",
    "  node scripts/codex-stage-run-lock.mjs release --owner-token <token> [--lock-root <path>] [--json]",
    "  node scripts/codex-stage-run-lock.mjs status [--lock-root <path>] [--json]",
    "  node scripts/codex-stage-run-lock.mjs force-release --confirm-stale-lock --reason <text> [--lock-root <path>] [--json]",
  ].join("\n");
}

async function runCli(argv) {
  const options = parseArgs(argv);
  let result;

  switch (options.command) {
    case "acquire":
      result = await acquireStageRunLock({ lockRoot: options.lockRoot });
      break;
    case "release":
      result = await releaseStageRunLock({
        lockRoot: options.lockRoot,
        ownerToken: options.ownerToken,
      });
      break;
    case "status":
      result = await readStageRunLockStatus({ lockRoot: options.lockRoot });
      break;
    case "force-release":
      result = await forceReleaseStageRunLock({
        lockRoot: options.lockRoot,
        confirmStaleLock: options.confirmStaleLock,
        reason: options.reason,
      });
      break;
    case "help":
    case undefined:
      process.stdout.write(`${usage()}\n`);
      return 0;
    default:
      throw new Error(`Unknown command: ${options.command}`);
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.acquired === true) {
    process.stdout.write(`lock acquired at ${result.lockDir}\n`);
  } else if (result.reason === "busy") {
    process.stdout.write(`lock busy at ${result.lockDir}\n`);
  } else if (result.released === true) {
    process.stdout.write(`lock released at ${result.lockDir}\n`);
  } else if (result.forced === true) {
    process.stdout.write(`lock force-released at ${result.lockDir}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }

  return result.ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exit(code);
    })
    .catch((error) => {
      process.stderr.write(
        `${JSON.stringify({ ok: false, message: error.message }, null, 2)}\n`
      );
      process.exit(1);
    });
}
