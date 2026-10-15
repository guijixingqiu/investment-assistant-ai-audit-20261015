#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import {
  CURRENT_STANDALONE_STAGE_IDS,
  HISTORICAL_STAGE_13_20_COMMIT_SHA,
  HISTORICAL_STAGE_13_20_MANIFEST_PATH,
  LOCAL_VALIDATION_REGISTRY_SAFETY,
  LOCAL_VALIDATION_REGISTRY_SCHEMA_VERSION,
  verifyStage13To20LocalValidationRegistry
} from "./lib/stage-13-20-local-validation-registry.mjs";
import {
  verifyControlledPersistenceStage,
  verifyRealDataQuantStage,
  verifyStage13To20Evidence
} from "./lib/stage-13-20-evidence.mjs";

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const GIT_EXECUTABLE = "/usr/bin/git";

export function runStage13To20LocalValidationRegistryCli(args, dependencies = {}) {
  const command = args[0] ?? "";
  const options = parseOptions(args.slice(1));
  const cwd = resolve(dependencies.cwd ?? process.cwd());
  if (command === "build") return buildRegistry(options, cwd, dependencies);
  if (command === "verify") return verifyRegistry(options, cwd, dependencies);
  throw new CliUsageError("command must be build or verify");
}

function buildRegistry(options, cwd, dependencies) {
  assertOnlyOptions(options, ["historical-manifest", "output", "standalone", "validation-head"]);
  const validationHeadSha = requiredSingle(options, "validation-head");
  if (!SHA_PATTERN.test(validationHeadSha)) throw new CliUsageError("--validation-head must be a 40-character lowercase SHA");
  requireRepositoryState(cwd, validationHeadSha, dependencies);

  const historicalPath = requiredSingle(options, "historical-manifest");
  if (historicalPath !== HISTORICAL_STAGE_13_20_MANIFEST_PATH) {
    throw new Error(`historical manifest must be ${HISTORICAL_STAGE_13_20_MANIFEST_PATH}`);
  }
  const historical = readGovernedArtifact(historicalPath, cwd);
  const historicalManifest = parseJson(historical.bytes, "historical manifest");
  if (historicalManifest?.commitSha !== HISTORICAL_STAGE_13_20_COMMIT_SHA) {
    throw new Error(`historical manifest must bind ${HISTORICAL_STAGE_13_20_COMMIT_SHA}`);
  }
  if (historicalManifest.commitSha === validationHeadSha) {
    throw new Error("historical manifest commit must differ from the validation head");
  }

  const currentStandaloneSections = {};
  for (const specification of options.get("standalone") ?? []) {
    const separator = specification.indexOf("=");
    if (separator <= 0 || separator === specification.length - 1) {
      throw new CliUsageError("each --standalone must use STAGE=artifacts/stage-13-20/path.json");
    }
    const stageId = specification.slice(0, separator);
    const path = specification.slice(separator + 1);
    if (!CURRENT_STANDALONE_STAGE_IDS.includes(stageId)) {
      throw new CliUsageError(`unsupported standalone stage: ${stageId}`);
    }
    if (Object.hasOwn(currentStandaloneSections, stageId)) {
      throw new CliUsageError(`duplicate standalone stage: ${stageId}`);
    }
    const artifact = readGovernedArtifact(path, cwd);
    const section = parseJson(artifact.bytes, `${stageId} standalone section`);
    if (section?.commitSha !== validationHeadSha) {
      throw new Error(`${stageId} standalone section does not bind the validation head`);
    }
    currentStandaloneSections[stageId] = artifact.reference;
  }

  const registry = {
    schemaVersion: LOCAL_VALIDATION_REGISTRY_SCHEMA_VERSION,
    validationHeadSha,
    historicalAggregate: {
      ...historical.reference,
      expectedCommitSha: historicalManifest.commitSha
    },
    currentStandaloneSections,
    safety: { ...LOCAL_VALIDATION_REGISTRY_SAFETY }
  };
  const outputPath = requiredSingle(options, "output");
  const output = writeGovernedArtifact(outputPath, registry, cwd);
  return {
    command: "build",
    outputPath: output.reference.path,
    sha256: output.reference.sha256,
    validationHeadSha,
    historicalCommitSha: historicalManifest.commitSha,
    currentStandaloneStages: Object.keys(currentStandaloneSections),
    safety: { ...LOCAL_VALIDATION_REGISTRY_SAFETY }
  };
}

function verifyRegistry(options, cwd, dependencies) {
  assertOnlyOptions(options, ["registry"]);
  const registryPath = requiredSingle(options, "registry");
  const registryArtifact = readGovernedArtifact(registryPath, cwd);
  const registry = parseJson(registryArtifact.bytes, "local-validation registry");
  requireRepositoryState(cwd, registry?.validationHeadSha, dependencies);

  const verifyHistoricalAggregate = dependencies.verifyHistoricalAggregate
    ?? verifyStage13To20Evidence;
  const verifyStandaloneSection = dependencies.verifyStandaloneSection
    ?? defaultStandaloneVerifier;
  const result = verifyStage13To20LocalValidationRegistry(registry, {
    readArtifact: (reference) => readGovernedArtifact(reference.path, cwd).bytes,
    verifyHistoricalAggregate,
    verifyStandaloneSection
  });
  return {
    command: "verify",
    registryPath: registryArtifact.reference.path,
    registrySha256: registryArtifact.reference.sha256,
    ...result
  };
}

function defaultStandaloneVerifier(stageId, section, expectedCommitSha) {
  if (stageId === "CONTROLLED-PERSISTENCE-1") {
    return verifyControlledPersistenceStage(section, expectedCommitSha);
  }
  if (stageId === "REAL-DATA-QUANT-1") {
    return verifyRealDataQuantStage(section, expectedCommitSha);
  }
  return { ok: false, failures: ["unsupported standalone stage"] };
}

function readRepositoryState(cwd) {
  const gitEnvironment = gitReadonlyEnvironment(cwd);
  const head = execFileSync(GIT_EXECUTABLE, ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
    env: gitEnvironment,
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
  const trackedStatus = execFileSync(
    GIT_EXECUTABLE,
    ["-c", "core.fsmonitor=false", "status", "--porcelain=v1", "--untracked-files=no"],
    {
      cwd,
      encoding: "utf8",
      env: gitEnvironment,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  return { head, trackedClean: trackedStatus.trim() === "" };
}

export function gitReadonlyEnvironment(cwd) {
  return {
    PATH: "/usr/bin:/bin",
    HOME: resolve(cwd),
    LC_ALL: "C",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0"
  };
}

function requireRepositoryState(cwd, expectedHead, dependencies) {
  const repositoryStateReader = dependencies.readRepositoryState ?? readRepositoryState;
  let repositoryState;
  try {
    repositoryState = repositoryStateReader(cwd);
  } catch (error) {
    throw new Error(`repository state is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (repositoryState?.head !== expectedHead) {
    throw new Error("registry validation head is not the exact current HEAD");
  }
  if (repositoryState?.trackedClean !== true) {
    throw new Error("tracked worktree must be clean for registry operations");
  }
}

function readGovernedArtifact(path, cwd) {
  const candidate = governedPath(path, cwd);
  assertNoSymlinkPath(candidate.root, candidate.absolute);
  const metadata = lstatSync(candidate.absolute);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error("registry artifact must be a regular non-symlink file");
  }
  const resolved = realpathSync(candidate.absolute);
  if (!insideRoot(candidate.realRoot, resolved)) {
    throw new Error("registry artifact must stay under artifacts/stage-13-20");
  }
  const bytes = readFileSync(resolved);
  return {
    bytes,
    reference: {
      path: candidate.relativePath,
      sha256: sha256(bytes)
    }
  };
}

function writeGovernedArtifact(path, value, cwd) {
  const candidate = governedPath(path, cwd, { allowMissingRoot: true });
  ensureSafeDirectoryTree(candidate.root, dirname(candidate.absolute));
  const realRoot = realpathSync(candidate.root);
  assertNoSymlinkPath(candidate.root, dirname(candidate.absolute));
  const realParent = realpathSync(dirname(candidate.absolute));
  if (realParent !== realRoot && !insideRoot(realRoot, realParent)) {
    throw new Error("registry output must stay under artifacts/stage-13-20");
  }
  try {
    lstatSync(candidate.absolute);
    throw new Error("registry output already exists");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const temporary = resolve(realParent, `.registry-${process.pid}-${Date.now()}.tmp`);
  try {
    writeFileSync(temporary, bytes, { mode: 0o600, flag: "wx" });
    renameSync(temporary, candidate.absolute);
  } finally {
    rmSync(temporary, { force: true });
  }
  return {
    bytes,
    reference: {
      path: candidate.relativePath,
      sha256: sha256(bytes)
    }
  };
}

function governedPath(path, cwd, { allowMissingRoot = false } = {}) {
  if (typeof path !== "string"
    || path.length === 0
    || isAbsolute(path)
    || path.includes("\\")
    || path.split("/").includes("..")
    || !path.startsWith("artifacts/stage-13-20/")) {
    throw new Error("registry paths must be relative files under artifacts/stage-13-20");
  }
  const normalized = path.split("/").filter(Boolean).join("/");
  if (normalized !== path) throw new Error("registry paths must be normalized");
  const root = resolve(cwd, "artifacts/stage-13-20");
  if (allowMissingRoot) ensureSafeDirectoryTree(cwd, root);
  else assertDirectoryTreeHasNoSymlinks(cwd, root);
  const rootMetadata = lstatSync(root);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error("artifacts/stage-13-20 must be a regular directory");
  }
  const realRoot = realpathSync(root);
  const realCwd = realpathSync(cwd);
  if (!insideRoot(realCwd, realRoot)) {
    throw new Error("artifacts/stage-13-20 must stay inside the repository root");
  }
  const absolute = resolve(cwd, path);
  if (!insideRoot(root, absolute)) {
    throw new Error("registry paths must stay under artifacts/stage-13-20");
  }
  return { absolute, relativePath: path, root, realRoot };
}

function ensureSafeDirectoryTree(base, target) {
  const pathFromBase = relative(base, target);
  if (pathFromBase === "") {
    assertRegularDirectory(base);
    return;
  }
  assertDescendantPath(pathFromBase);
  assertRegularDirectory(base);
  let current = base;
  for (const segment of pathFromBase.split(sep)) {
    current = resolve(current, segment);
    try {
      assertRegularDirectory(current);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      mkdirSync(current, { mode: 0o700 });
      assertRegularDirectory(current);
    }
  }
}

function assertDirectoryTreeHasNoSymlinks(base, target) {
  const pathFromBase = relative(base, target);
  if (pathFromBase === "") {
    assertRegularDirectory(base);
    return;
  }
  assertDescendantPath(pathFromBase);
  assertRegularDirectory(base);
  let current = base;
  for (const segment of pathFromBase.split(sep)) {
    current = resolve(current, segment);
    assertRegularDirectory(current);
  }
}

function assertDescendantPath(path) {
  if (path === "" || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error("registry directory must stay inside its governed base");
  }
}

function assertRegularDirectory(path) {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error("registry directory path must contain only regular directories");
  }
}

function assertNoSymlinkPath(root, target) {
  const pathFromRoot = relative(root, target);
  if (pathFromRoot === "" || pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === "..") return;
  let current = root;
  for (const segment of pathFromRoot.split(sep)) {
    current = resolve(current, segment);
    let metadata;
    try {
      metadata = lstatSync(current);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    if (metadata.isSymbolicLink()) throw new Error("registry paths must not contain symlinks");
  }
}

function insideRoot(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot !== ""
    && pathFromRoot !== ".."
    && !pathFromRoot.startsWith(`..${sep}`)
    && !isAbsolute(pathFromRoot);
}

function parseOptions(args) {
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (typeof option !== "string" || !option.startsWith("--") || value === undefined) {
      throw new CliUsageError("options must use --name value pairs");
    }
    const name = option.slice(2);
    const values = options.get(name) ?? [];
    values.push(value);
    options.set(name, values);
  }
  return options;
}

function assertOnlyOptions(options, allowed) {
  for (const option of options.keys()) {
    if (!allowed.includes(option)) throw new CliUsageError(`unsupported option: --${option}`);
  }
}

function requiredSingle(options, name) {
  const values = options.get(name) ?? [];
  if (values.length !== 1) throw new CliUsageError(`--${name} is required exactly once`);
  return values[0];
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

class CliUsageError extends Error {
  constructor(message) {
    super(message);
    this.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const output = runStage13To20LocalValidationRegistryCli(process.argv.slice(2));
    console.log(JSON.stringify(output, null, 2));
    if (output.command === "verify" && output.registryValid !== true) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1;
  }
}
