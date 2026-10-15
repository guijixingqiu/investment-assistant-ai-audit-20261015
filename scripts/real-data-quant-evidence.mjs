#!/usr/bin/env node
import { execFile, execFileSync } from "node:child_process";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  rmdir,
  unlink,
  writeFile
} from "node:fs/promises";
import { delimiter, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  buildRealDataQuantSourceBundle,
  buildRealDataQuantTargetBundle,
  canonicalJsonBytes,
  sha256,
  validateRealDataQuantSourceBundle
} from "./lib/real-data-quant-evidence.mjs";
import { expectedRealDataQuantBuildInputPaths } from "./lib/real-data-quant-witness.mjs";
import { verifyRealDataQuantStage } from "./lib/stage-13-20-evidence.mjs";
import { runBaselineSplit } from "./quant-sample-split-baseline.mjs";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifactRootPath = "artifacts/stage-13-20/real-data-quant";
const freezeConfigPath = "config/quant-freeze-snapshot.pingan-hk-09926.json";
const pipelineConfigPath = "config/quant-pipeline.pingan-hk-09926.json";
const sampleSplitConfigPath = "config/quant-sample-split-baseline.pingan-hk-09926.json";
const experimentConfigPaths = [
  "config/quant-smoke.pingan-hk-09926-high-turnover.json",
  "config/quant-smoke.pingan-hk-09926-sparse.json",
  "config/quant-smoke.pingan-hk-09926-zero-threshold.json",
  "config/quant-smoke.pingan-hk-09926-ultra-sparse.json"
];
const allowedQuantChildOverrides = new Set(["QUANT_SAMPLE_SPLIT_BASELINE_CONFIG"]);
const gitExecutable = "/usr/bin/git";
const gitEnv = gitReadonlyEnvironment(root);

export function gitReadonlyEnvironment(repositoryRoot) {
  return {
    PATH: "/usr/bin:/bin",
    HOME: resolve(repositoryRoot),
    LC_ALL: "C",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0"
  };
}

export async function main(args = process.argv.slice(2), nodeVersion = process.versions.node) {
  const command = args[0] ?? "";
  if (command === "--help" || command === "help") {
    printUsage();
    return;
  }
  requireNode24(nodeVersion);
  const options = parseOptions(args.slice(1));
  if (command === "source") await createSource(options);
  else if (command === "target") await createTarget(options);
  else throw new Error("command must be source or target");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function createSource(options) {
  rejectUnknownOptions(options, ["commit", "freeze-config", "pipeline-config", "sample-split-config", "output-dir"]);
  const sourceCommitSha = requiredSingle(options, "commit");
  const freezePath = normalizeRepoPath(requiredSingle(options, "freeze-config"));
  const pipelinePath = normalizeRepoPath(requiredSingle(options, "pipeline-config"));
  const sampleSplitPath = normalizeRepoPath(requiredSingle(options, "sample-split-config"));
  const outputDir = normalizeEvidenceOutputDir(requiredSingle(options, "output-dir"));
  if (freezePath !== freezeConfigPath) throw new Error(`Stage 19 freeze config must be ${freezeConfigPath}`);
  if (pipelinePath !== pipelineConfigPath) throw new Error(`Stage 19 pipeline must be ${pipelineConfigPath}`);
  if (sampleSplitPath !== sampleSplitConfigPath) throw new Error(`Stage 19 sample-split config must be ${sampleSplitConfigPath}`);
  await ensureOutputAbsent(outputDir);

  requireExactHead(sourceCommitSha);
  requireWorktreeClean();
  const freezeConfig = await readRepoJson(freezePath);
  const pipelineConfig = await readRepoJson(pipelinePath);
  const sampleSplitConfig = await readRepoJson(sampleSplitPath);
  if (pipelineConfig.freezeConfigPath !== freezePath || sampleSplitConfig.freezeConfigPath !== freezePath) {
    throw new Error("pipeline and sample-split configs must bind the requested freeze config");
  }
  const approvedInputPath = normalizeApprovedInputPath(freezeConfig.sourcePath);
  const smokeConfigPath = normalizeRepoPath(pipelineConfig.smokeConfigPath);
  const approvedInputBytes = await requireTrackedBytesAtCommit(approvedInputPath, sourceCommitSha);
  const approvedInput = parseJson(approvedInputBytes, "approved input");
  const buildInputPaths = expectedRealDataQuantBuildInputPaths(
    approvedInputPath,
    smokeConfigPath,
    approvedInput.formalAccounting
  );
  const trackedBytes = new Map([[approvedInputPath, approvedInputBytes]]);
  for (const path of buildInputPaths) trackedBytes.set(path, await requireTrackedBytesAtCommit(path, sourceCommitSha));
  const buildInputs = buildInputPaths.map((path) => ({
    path,
    sha256: sha256(trackedBytes.get(path))
  }));
  const buildInputHash = sha256(canonicalJsonBytes(buildInputs));

  const smokeConfig = parseJson(trackedBytes.get(smokeConfigPath), smokeConfigPath);
  const experimentConfigs = experimentConfigPaths.map((path) => parseJson(trackedBytes.get(path), path));
  const pipelineDir = normalizeEvidenceOutputDir(pipelineConfig.outputDir);
  const sampleSplitDir = normalizeEvidenceOutputDir(sampleSplitConfig.outputDir);
  const configuredOutputDirs = [
    normalizeEvidenceOutputDir(freezeConfig.outputDir),
    pipelineDir,
    normalizeEvidenceOutputDir(`${pipelineDir}/smoke`),
    sampleSplitDir,
    normalizeEvidenceOutputDir(smokeConfig.outputDir),
    ...experimentConfigs.map((config) => normalizeEvidenceOutputDir(config.outputDir)),
    outputDir
  ];
  await prepareStage19ArtifactDirectories(root, configuredOutputDirs);
  await requireTrustedNodeRuntime();

  await runLocalScript("scripts/quant-real-data-evidence-summary.mjs");
  await runLocalScript("scripts/quant-sample-split-baseline.mjs", {
    QUANT_SAMPLE_SPLIT_BASELINE_CONFIG: sampleSplitPath
  });
  requireExactHead(sourceCommitSha);
  requireWorktreeClean();

  const frozenManifest = await readRepoJson(`${pipelineDir}/frozen-manifest.json`);
  const frozenSnapshot = await readRepoJson(`${pipelineDir}/frozen-snapshot.json`);
  const pipelineManifest = await readRepoJson(`${pipelineDir}/run_manifest.json`);
  const smokeManifest = await readRepoJson(`${pipelineDir}/smoke/run_manifest.json`);
  const sampleSplitManifest = await readRepoJson(`${sampleSplitDir}/run_manifest.json`);
  const summary = await readRepoJson(`${artifactRootPath}/summary.json`);
  const quantAudit = await readRepoJson(`${pipelineDir}/smoke/quant-audit.json`);
  const signals = await readRepoJson(`${pipelineDir}/smoke/signals.json`);
  const orders = await readRepoJson(`${pipelineDir}/smoke/orders.json`);
  const trades = await readRepoJson(`${pipelineDir}/smoke/trades.json`);
  const ledger = await readRepoJson(`${pipelineDir}/smoke/ledger.json`);
  const nav = await readRepoJson(`${pipelineDir}/smoke/nav.json`);
  const failedExperiments = [];
  for (let index = 0; index < experimentConfigs.length; index += 1) {
    const config = experimentConfigs[index];
    const configPath = experimentConfigPaths[index];
    const summaryEntry = summary.failedExperiments.find((entry) => entry.experimentId === config.experiment.experimentId);
    if (!summaryEntry) throw new Error(`summary is missing failed experiment ${config.experiment.experimentId}`);
    failedExperiments.push({
      id: summaryEntry.id,
      configPath,
      manifest: await readRepoJson(`${normalizeEvidenceOutputDir(config.outputDir)}/run_manifest.json`),
      trades: await readRepoJson(`${normalizeEvidenceOutputDir(config.outputDir)}/trades.json`)
    });
  }
  const nonTradeableProbe = runNonTradeableProbe(sampleSplitConfig, freezeConfig);
  const bundle = buildRealDataQuantSourceBundle({
    sourceCommitSha,
    approvedInput,
    approvedInputBytes,
    freezeConfig,
    buildInputs,
    buildInputBytes: trackedBytes,
    nodeVersion: process.versions.node,
    run: {
      frozenManifest,
      frozenSnapshot,
      pipelineManifest,
      quantAudit,
      smokeManifest,
      sampleSplitManifest,
      summary,
      formalAccounting: summary.formalAccounting,
      signals,
      orders,
      trades,
      ledger,
      nav,
      accountingAudit: smokeManifest.accountingAudit,
      failedExperiments
    },
    outputDir,
    nonTradeableProbe
  });
  await writeSourceBundleAtomically(outputDir, bundle.files);
  console.log(JSON.stringify({
    ok: true,
    sourceCommitSha,
    outputDir,
    buildInputHash,
    artifacts: bundle.files.map(({ artifact }) => artifact)
  }, null, 2));
}

async function createTarget(options) {
  rejectUnknownOptions(options, [
    "source-section", "source-commit", "evidence-commit", "target-commit", "inheritance-output", "output"
  ]);
  const sourceSectionPath = normalizeArtifactPath(requiredSingle(options, "source-section"));
  const sourceCommitSha = requiredSingle(options, "source-commit");
  const evidenceCommitSha = requiredSingle(options, "evidence-commit");
  const targetCommitSha = requiredSingle(options, "target-commit");
  const inheritancePath = normalizeArtifactPath(requiredSingle(options, "inheritance-output"));
  const targetSectionPath = normalizeArtifactPath(requiredSingle(options, "output"));
  requireExactHead(targetCommitSha);
  requireWorktreeClean();
  requireDistinctCommits(sourceCommitSha, evidenceCommitSha, targetCommitSha);
  requireAncestor(sourceCommitSha, evidenceCommitSha);
  requireAncestor(evidenceCommitSha, targetCommitSha);
  await prepareStage19ArtifactDirectories(root, [
    dirname(sourceSectionPath),
    dirname(inheritancePath),
    dirname(targetSectionPath)
  ]);

  const sourceSectionBytes = await readGovernedArtifact(sourceSectionPath);
  const sourceSection = parseCanonicalJson(sourceSectionBytes, "source section");
  const proofArtifact = sourceSection?.artifacts?.[0];
  const sourceArtifact = sourceSection?.source?.artifacts?.[0];
  const snapshotArtifact = sourceSection?.snapshot?.artifacts?.[0];
  const runWitnessArtifact = sourceSection?.runWitness?.artifacts?.[0];
  const proofBytes = await readHashedArtifact(proofArtifact);
  const sourceBytes = await readHashedArtifact(sourceArtifact);
  const snapshotBytes = await readHashedArtifact(snapshotArtifact);
  const runWitnessBytes = await readHashedArtifact(runWitnessArtifact);
  const proof = parseCanonicalJson(proofBytes, "proof");
  const historicalSource = parseCanonicalJson(sourceBytes, "historical source");
  const snapshot = parseCanonicalJson(snapshotBytes, "snapshot");
  const runWitness = parseCanonicalJson(runWitnessBytes, "run witness");
  const sourceSectionArtifact = { path: sourceSectionPath, sha256: sha256(sourceSectionBytes) };
  validateRealDataQuantSourceBundle({
    files: [
      { artifact: sourceArtifact, bytes: sourceBytes, value: historicalSource },
      { artifact: snapshotArtifact, bytes: snapshotBytes, value: snapshot },
      { artifact: runWitnessArtifact, bytes: runWitnessBytes, value: runWitness },
      { artifact: proofArtifact, bytes: proofBytes, value: proof },
      { artifact: sourceSectionArtifact, bytes: sourceSectionBytes, value: sourceSection }
    ],
    sourceSection,
    proof,
    historicalSource,
    snapshot,
    runWitness,
    sourceCommitSha,
    sourceFileBytes: (path) => committedBytes(sourceCommitSha, path)
  });
  for (const [path, bytes] of [
    [sourceSectionPath, sourceSectionBytes],
    [proofArtifact.path, proofBytes],
    [sourceArtifact.path, sourceBytes],
    [snapshotArtifact.path, snapshotBytes],
    [runWitnessArtifact.path, runWitnessBytes]
  ]) {
    requireCommittedBytes(evidenceCommitSha, path, bytes);
    requireCommittedBytes(targetCommitSha, path, bytes);
  }
  const changedPaths = changedPathsAcross(sourceCommitSha, evidenceCommitSha, targetCommitSha);
  const target = buildRealDataQuantTargetBundle({
    sourceSection,
    sourceSectionArtifact,
    sourceCommitSha,
    evidenceCommitSha,
    targetCommitSha,
    changedPaths,
    inheritancePath,
    targetSectionPath
  });
  await ensureOutputAbsent(inheritancePath);
  await ensureOutputAbsent(targetSectionPath);
  const createdPaths = [];
  try {
    await writeAtomicArtifact(inheritancePath, target.inheritanceFile.bytes);
    createdPaths.push(inheritancePath);
    await writeAtomicArtifact(targetSectionPath, target.targetSectionFile.bytes);
    createdPaths.push(targetSectionPath);
    const verification = verifyRealDataQuantStage(target.targetSection, targetCommitSha);
    if (!verification.ok) throw new Error(`final Stage 19 target verification failed: ${verification.failures.join(", ")}`);
  } catch (error) {
    await Promise.all(createdPaths.map((path) => rm(resolve(root, path), { force: true })));
    throw error;
  }
  console.log(JSON.stringify({
    ok: true,
    sourceCommitSha,
    evidenceCommitSha,
    targetCommitSha,
    changedPaths,
    inheritance: target.inheritanceFile.artifact,
    targetSection: target.targetSectionFile.artifact
  }, null, 2));
}

export function runNonTradeableProbe(config, freezeConfig) {
  const base = {
    market: "HK", code: "09926", open: 100, high: 101, low: 89, close: 100,
    volume: 1000, turnover: 100000, adjustment: "none"
  };
  const bars = (override) => [
    { ...base, tradeDate: "2026-05-04", close: 100 },
    { ...base, tradeDate: "2026-05-05", close: 90 },
    { ...base, ...override, tradeDate: "2026-05-06", open: 90, close: 91 }
  ];
  const cfg = {
    initialCash: config.initialCash,
    targetGrossExposure: config.targetGrossExposure,
    strategy: config.strategy,
    fees: config.fees
  };
  const snapshot = { universe: freezeConfig.universe, adjustment: "none" };
  const probe = (override) => {
    const inputBars = bars(override);
    return { bars: inputBars, run: runBaselineSplit({ id: "probe" }, inputBars, cfg, snapshot) };
  };
  return {
    zeroVolume: probe({ volume: 0, turnover: 0 }),
    suspended: probe({ suspended: true })
  };
}

async function runLocalScript(scriptPath, extraEnv = {}) {
  const env = buildQuantChildEnvironment(extraEnv);
  await execFileAsync(process.execPath, [scriptPath], {
    cwd: root,
    env,
    maxBuffer: 80 * 1024 * 1024
  });
}

export function buildQuantChildEnvironment(extraEnv = {}, {
  inheritedEnvironment = process.env,
  nodeExecutable = process.execPath,
  repositoryRoot = root
} = {}) {
  void inheritedEnvironment;
  for (const [name, value] of Object.entries(extraEnv)) {
    if (!allowedQuantChildOverrides.has(name) || typeof value !== "string" || value.length === 0) {
      throw new Error(`unsupported quant child environment override: ${name}`);
    }
  }
  return {
    PATH: [dirname(nodeExecutable), "/usr/bin", "/bin"].join(delimiter),
    HOME: resolve(repositoryRoot, artifactRootPath),
    CI: "1",
    TZ: "UTC",
    NO_COLOR: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_TERMINAL_PROMPT: "0",
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_GLOBALCONFIG: "/dev/null",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    NPM_CONFIG_USERCONFIG: "/dev/null",
    ...extraEnv
  };
}

async function requireTrustedNodeRuntime() {
  const nodePath = resolve(process.execPath);
  const nodeMetadata = await lstat(nodePath);
  if (nodeMetadata.isSymbolicLink() || !nodeMetadata.isFile()) {
    throw new Error("quant child Node executable must be a regular non-symlink file");
  }
  await realpath(nodePath);
}

async function requireTrackedBytesAtCommit(path, commitSha) {
  const local = await readRepoRegularFile(path);
  try {
    execFileSync(gitExecutable, ["ls-files", "--error-unmatch", "--", path], { cwd: root, env: gitEnv, stdio: "ignore" });
  } catch {
    throw new Error(`build input is not tracked: ${path}`);
  }
  let committed;
  try {
    committed = execFileSync(gitExecutable, ["show", `${commitSha}:${path}`], {
      cwd: root,
      env: gitEnv,
      maxBuffer: 80 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"]
    });
  } catch {
    throw new Error(`build input is absent from source commit ${commitSha}: ${path}`);
  }
  if (!local.equals(committed)) throw new Error(`local build input differs from source commit ${commitSha}: ${path}`);
  return local;
}

function requireExactHead(commitSha) {
  const head = gitText(["rev-parse", "HEAD"]).trim();
  if (head !== commitSha) throw new Error(`requested commit ${commitSha} is not exact HEAD ${head}`);
}

function requireWorktreeClean() {
  const status = gitText(["status", "--porcelain=v1", "--untracked-files=normal"]).trim();
  if (status) throw new Error("worktree must be clean before Stage 19 evidence generation");
}

function requireDistinctCommits(...commits) {
  if (commits.some((sha) => !/^[a-f0-9]{40}$/.test(sha)) || new Set(commits).size !== commits.length) {
    throw new Error("source, evidence, and target commits must be distinct exact SHAs");
  }
}

function requireAncestor(source, target) {
  try {
    execFileSync(gitExecutable, ["merge-base", "--is-ancestor", source, target], { cwd: root, env: gitEnv, stdio: "ignore" });
  } catch {
    throw new Error(`${source} is not an ancestor of ${target}`);
  }
}

function requireCommittedBytes(commitSha, path, expected) {
  let actual;
  try {
    actual = execFileSync(gitExecutable, ["show", `${commitSha}:${path}`], {
      cwd: root, env: gitEnv, maxBuffer: 80 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"]
    });
  } catch {
    throw new Error(`artifact is not committed at ${commitSha}: ${path}`);
  }
  if (!actual.equals(expected)) throw new Error(`artifact bytes changed at ${commitSha}: ${path}`);
}

function committedBytes(commitSha, path) {
  try {
    return execFileSync(gitExecutable, ["show", `${commitSha}:${path}`], {
      cwd: root, env: gitEnv, maxBuffer: 80 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"]
    });
  } catch {
    return null;
  }
}

function changedPathsAcross(source, evidence, target) {
  return [...new Set([...changedPaths(source, evidence), ...changedPaths(evidence, target)])].sort();
}

function changedPaths(source, target) {
  return gitText(["log", "--format=", "--name-only", "--no-renames", "-m", "--ancestry-path", `${source}..${target}`, "--"])
    .split("\n").filter(Boolean);
}

function gitText(args) {
  return execFileSync(gitExecutable, args, { cwd: root, env: gitEnv, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

async function writeSourceBundleAtomically(outputDir, files) {
  const absoluteOutput = resolve(root, outputDir);
  await prepareStage19ArtifactDirectories(root, [outputDir]);
  await ensureOutputAbsent(outputDir);
  const parent = dirname(absoluteOutput);
  await requireInsideArtifactRoot(parent);
  const temporary = await mkdtemp(join(parent, ".real-data-quant-evidence-"));
  const stagedFiles = [];
  const publishedFiles = [];
  let outputCreated = false;
  try {
    for (const file of files) {
      const name = file.path.slice(outputDir.length + 1);
      const staged = join(temporary, name);
      await writeFile(staged, file.bytes, { mode: 0o600 });
      stagedFiles.push([staged, join(absoluteOutput, name)]);
    }
    await mkdir(absoluteOutput, { mode: 0o700 });
    outputCreated = true;
    for (const [staged, published] of stagedFiles) {
      await link(staged, published);
      publishedFiles.push(published);
    }
  } catch (error) {
    await Promise.all(publishedFiles.map((path) => unlink(path).catch(() => {})));
    if (outputCreated) await rmdir(absoluteOutput).catch(() => {});
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function writeAtomicArtifact(path, bytes) {
  const absolute = resolve(root, path);
  await ensureStage19ArtifactDirectory(root, dirname(path));
  await requireInsideArtifactRoot(dirname(absolute));
  const temporary = await mkdtemp(join(dirname(absolute), ".real-data-quant-file-"));
  const temporaryFile = join(temporary, "value.json");
  try {
    await writeFile(temporaryFile, bytes, { mode: 0o600 });
    await link(temporaryFile, absolute);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function ensureOutputAbsent(path) {
  try {
    await lstat(resolve(root, path));
    throw new Error(`refusing to overwrite existing evidence output: ${path}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function readHashedArtifact(artifact) {
  if (!artifact || typeof artifact.path !== "string" || !/^[a-f0-9]{64}$/.test(artifact.sha256 ?? "")) {
    throw new Error("artifact reference is invalid");
  }
  const bytes = await readGovernedArtifact(normalizeArtifactPath(artifact.path));
  if (sha256(bytes) !== artifact.sha256) throw new Error(`artifact hash mismatch: ${artifact.path}`);
  return bytes;
}

async function readGovernedArtifact(path) {
  await requireInsideArtifactRoot(resolve(root, path));
  return readRepoRegularFile(path);
}

async function readRepoJson(path) {
  return parseJson(await readRepoRegularFile(path), path);
}

async function readRepoRegularFile(path) {
  const normalized = normalizeRepoPath(path);
  const absolute = resolve(root, normalized);
  const resolved = await realpath(absolute);
  const metadata = await lstat(absolute);
  const fromRoot = relative(root, resolved);
  if (fromRoot.startsWith(`..${sep}`) || fromRoot === ".." || metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`repository input must be a regular in-repository file: ${normalized}`);
  }
  return readFile(resolved);
}

async function requireInsideArtifactRoot(path) {
  const repository = await inspectRepositoryRoot(root);
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) throw new Error("Stage 19 evidence paths must not be symbolic links");
  const directory = metadata.isDirectory() ? path : dirname(path);
  await inspectDirectoryChain(repository, relative(repository.absolute, directory).split(sep).join("/"));
  await inspectDirectoryChain(repository, artifactRootPath);
  const allowed = await realpath(resolve(repository.absolute, artifactRootPath));
  if (!inside(repository.real, allowed)) throw new Error("Stage 19 artifact root escapes the repository");
  const resolved = await realpath(path);
  if (!inside(allowed, resolved, true)) throw new Error("evidence path escapes the Stage 19 artifact root");
}

export async function prepareStage19ArtifactDirectories(repositoryRoot, outputDirectories) {
  const repository = await inspectRepositoryRoot(repositoryRoot);
  if (!Array.isArray(outputDirectories) || outputDirectories.length === 0) {
    throw new Error("at least one Stage 19 output directory is required");
  }
  const directories = [...new Set(outputDirectories.map((path) =>
    normalizeStage19Directory(repository.absolute, path)))];

  // Complete the read-only inspection pass before the first mkdir. This keeps
  // one poisoned sibling path from causing partial directory creation.
  for (const path of [artifactRootPath, ...directories]) await inspectDirectoryChain(repository, path);
  await inspectExistingArtifactTree(repository);

  await ensureSafeDirectoryChain(repository, artifactRootPath);
  for (const path of directories) await ensureSafeDirectoryChain(repository, dirname(path));
  for (const path of directories) await inspectDirectoryChain(repository, path);
}

export async function ensureStage19ArtifactDirectory(repositoryRoot, outputDirectory) {
  await prepareStage19ArtifactDirectories(repositoryRoot, [outputDirectory]);
  const repository = await inspectRepositoryRoot(repositoryRoot);
  const normalized = normalizeStage19Directory(repository.absolute, outputDirectory);
  await ensureSafeDirectoryChain(repository, normalized);
  await inspectDirectoryChain(repository, normalized);
}

async function inspectExistingArtifactTree(repository) {
  const artifactRoot = resolve(repository.absolute, artifactRootPath);
  try {
    const metadata = await lstat(artifactRoot);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error("Stage 19 artifact tree contains a symlink or non-directory root");
    }
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  await inspectExistingArtifactDirectory(repository, artifactRoot);
}

async function inspectExistingArtifactDirectory(repository, directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = join(directory, entry.name);
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink()) {
      throw new Error("Stage 19 artifact tree contains a symlink or non-regular entry");
    }
    if (metadata.isDirectory()) {
      const resolved = await realpath(candidate);
      if (!inside(repository.real, resolved)) throw new Error("Stage 19 artifact tree escapes the repository cwd");
      await inspectExistingArtifactDirectory(repository, candidate);
      continue;
    }
    if (!metadata.isFile()) {
      throw new Error("Stage 19 artifact tree contains a symlink or non-regular entry");
    }
  }
}

async function inspectRepositoryRoot(repositoryRoot) {
  const absolute = resolve(repositoryRoot);
  const metadata = await lstat(absolute);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error("repository cwd must be a regular non-symlink directory");
  }
  const real = await realpath(absolute);
  return { absolute, real };
}

async function inspectDirectoryChain(repository, relativeDirectory) {
  const normalized = normalizeDirectory(repository.absolute, relativeDirectory);
  if (normalized === ".") return;
  let current = repository.absolute;
  for (const segment of normalized.split("/")) {
    current = join(current, segment);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(`Stage 19 directory chain contains a symlink or non-directory: ${normalized}`);
    }
    const resolved = await realpath(current);
    if (!inside(repository.real, resolved)) throw new Error("Stage 19 directory chain escapes the repository cwd");
  }
}

async function ensureSafeDirectoryChain(repository, relativeDirectory) {
  const normalized = normalizeDirectory(repository.absolute, relativeDirectory);
  if (normalized === ".") return;
  let current = repository.absolute;
  for (const segment of normalized.split("/")) {
    current = join(current, segment);
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error(`Stage 19 directory chain contains a symlink or non-directory: ${normalized}`);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await mkdir(current, { mode: 0o700 });
    }
    const resolved = await realpath(current);
    if (!inside(repository.real, resolved)) throw new Error("Stage 19 directory chain escapes the repository cwd");
  }
}

function normalizeStage19Directory(repositoryRoot, path) {
  const normalized = normalizeDirectory(repositoryRoot, path);
  if (normalized !== artifactRootPath && !normalized.startsWith(`${artifactRootPath}/`)) {
    throw new Error(`Stage 19 output directory must stay under ${artifactRootPath}`);
  }
  return normalized;
}

function normalizeDirectory(repositoryRoot, path) {
  if (typeof path !== "string" || path.length === 0 || path.includes("\\") || path.split("/").includes("..")) {
    throw new Error("Stage 19 directory must be repository-relative without traversal");
  }
  const normalized = relative(repositoryRoot, resolve(repositoryRoot, path)).split(sep).join("/");
  if (normalized === ".." || normalized.startsWith("../")) throw new Error("Stage 19 directory escapes the repository cwd");
  return normalized || ".";
}

function inside(base, candidate, allowSame = false) {
  const fromBase = relative(base, candidate);
  return (allowSame && fromBase === "")
    || (fromBase !== "" && fromBase !== ".." && !fromBase.startsWith(`..${sep}`) && !fromBase.startsWith("../"));
}

function parseCanonicalJson(bytes, label) {
  const value = parseJson(bytes, label);
  if (!canonicalJsonBytes(value).equals(bytes)) throw new Error(`${label} is not canonical fixed JSON`);
  return value;
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} must contain valid JSON`);
  }
}

function normalizeApprovedInputPath(path) {
  const normalized = normalizeRepoPath(path);
  if (!normalized.startsWith("data/quant-approved/")) throw new Error("approved input must stay under data/quant-approved/");
  return normalized;
}

function normalizeEvidenceOutputDir(path) {
  const normalized = normalizeRepoPath(path).replace(/\/$/, "");
  if (!normalized.startsWith(`${artifactRootPath}/`) || normalized === artifactRootPath) {
    throw new Error(`evidence output must stay below ${artifactRootPath}/`);
  }
  return normalized;
}

function normalizeArtifactPath(path) {
  const normalized = normalizeRepoPath(path);
  if (!normalized.startsWith(`${artifactRootPath}/`)) throw new Error("artifact must stay under the Stage 19 artifact root");
  return normalized;
}

function normalizeRepoPath(path) {
  if (typeof path !== "string" || path.length === 0 || path.startsWith("/") || path.includes("\\")
    || path.split("/").includes("..")) throw new Error("path must be repository-relative without traversal");
  const normalized = relative(root, resolve(root, path)).split(sep).join("/");
  if (normalized === ".." || normalized.startsWith("../")) throw new Error("path escapes repository root");
  return normalized;
}

function parseOptions(args) {
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error("options must use --name value pairs");
    }
    const key = name.slice(2);
    options.set(key, [...(options.get(key) ?? []), value]);
  }
  return options;
}

function rejectUnknownOptions(options, allowed) {
  for (const key of options.keys()) if (!allowed.includes(key)) throw new Error(`unsupported option --${key}`);
}

function requiredSingle(options, name) {
  const values = options.get(name) ?? [];
  if (values.length !== 1) throw new Error(`exactly one --${name} is required`);
  return values[0];
}

export function requireNode24(version) {
  if (Number(String(version).split(".")[0]) !== 24) throw new Error(`Node 24 is required, received ${version}`);
}

export function validateArtifactRootMetadata(metadata) {
  if (!metadata || metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error("Stage 19 artifact root must be a regular directory, not a symbolic link");
  }
}

function printUsage() {
  console.log(`Usage:
  node scripts/real-data-quant-evidence.mjs source --commit <S> --freeze-config <path> --pipeline-config <path> --sample-split-config <path> --output-dir <path>
  node scripts/real-data-quant-evidence.mjs target --source-section <path> --source-commit <S> --evidence-commit <R> --target-commit <T> --inheritance-output <path> --output <path>`);
}
