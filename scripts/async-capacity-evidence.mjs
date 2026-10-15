#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  buildCapacitySourceSection,
  buildCapacityTargetSection
} from "./lib/async-capacity-evidence.mjs";
import { isCapacityInheritanceSafePath } from "./lib/stage-13-20-evidence.mjs";

const command = process.argv[2] ?? "";
if (command === "--help" || command === "help") {
  printUsage();
  process.exit(0);
}

try {
  if (command === "source") await createSourceSection(parseOptions(process.argv.slice(3)));
  else if (command === "target") await createTargetSection(parseOptions(process.argv.slice(3)));
  else throw new Error("command must be source or target");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function createSourceSection(options) {
  const commitSha = requiredSingle(options, "commit");
  requireExactHead(commitSha);
  requireTrackedWorktreeClean();
  const outputPath = requiredSingle(options, "output");
  const measurementSpecs = options.get("measurement") ?? [];
  const entries = [];
  for (const spec of measurementSpecs) {
    const separator = spec.indexOf("=");
    if (separator <= 0 || separator === spec.length - 1) {
      throw new Error("each --measurement must use label=artifacts/stage-13-20/path.json");
    }
    const label = spec.slice(0, separator);
    const path = spec.slice(separator + 1);
    entries.push({ label, path: normalizeRepoPath(path), bytes: await readGovernedArtifact(path) });
  }
  const section = buildCapacitySourceSection(entries, commitSha);
  const written = await writeGovernedArtifact(outputPath, section);
  console.log(JSON.stringify({
    ok: section.decision === "keep_synchronous",
    blocked: section.decision !== "keep_synchronous",
    outputPath: written.path,
    sha256: written.sha256,
    sourceCommitSha: commitSha,
    decision: section.decision,
    redisIntroduced: false,
    workerIntroduced: false,
    measurements: section.measurements.map(summarizeMeasurement)
  }, null, 2));
  if (section.decision !== "keep_synchronous") process.exitCode = 1;
}

async function createTargetSection(options) {
  const sourceSectionPath = requiredSingle(options, "source-section");
  const sourceCommitSha = requiredSingle(options, "source-commit");
  const evidenceCommitSha = requiredSingle(options, "evidence-commit");
  const targetCommitSha = requiredSingle(options, "target-commit");
  const outputPath = requiredSingle(options, "output");
  requireExactHead(targetCommitSha);
  requireTrackedWorktreeClean();
  requireAncestor(sourceCommitSha, evidenceCommitSha);
  requireAncestor(evidenceCommitSha, targetCommitSha);

  const sourceSectionBytes = await readGovernedArtifact(sourceSectionPath);
  const sourceSection = JSON.parse(sourceSectionBytes.toString("utf8"));
  const reconstructed = await reconstructSourceSection(sourceSection, sourceCommitSha);
  if (!isDeepStrictEqual(sourceSection, reconstructed)) {
    throw new Error("source section does not exactly match its committed probe bytes");
  }
  const sourceSectionArtifact = {
    path: normalizeRepoPath(sourceSectionPath),
    sha256: sha256(sourceSectionBytes)
  };
  const preservedArtifacts = [sourceSectionArtifact, ...sourceSection.artifacts];
  for (const artifact of preservedArtifacts) {
    const localBytes = await readGovernedArtifact(artifact.path);
    if (sha256(localBytes) !== artifact.sha256) throw new Error(`artifact hash mismatch: ${artifact.path}`);
    requireCommittedBytes(evidenceCommitSha, artifact.path, localBytes);
    requireCommittedBytes(targetCommitSha, artifact.path, localBytes);
  }

  const changedPaths = changedPathsAcross(sourceCommitSha, evidenceCommitSha, targetCommitSha);
  const targetSection = buildCapacityTargetSection({
    sourceSection,
    sourceSectionPath: sourceSectionArtifact.path,
    sourceSectionSha256: sourceSectionArtifact.sha256,
    sourceCommitSha,
    evidenceCommitSha,
    targetCommitSha,
    changedPaths,
    isSafePath: isCapacityInheritanceSafePath
  });
  const written = await writeGovernedArtifact(outputPath, targetSection);
  console.log(JSON.stringify({
    ok: targetSection.decision === "keep_synchronous",
    blocked: targetSection.decision !== "keep_synchronous",
    outputPath: written.path,
    sha256: written.sha256,
    sourceCommitSha,
    evidenceCommitSha,
    targetCommitSha,
    decision: targetSection.decision,
    changedPaths,
    measurements: targetSection.measurements.map(summarizeMeasurement)
  }, null, 2));
  if (targetSection.decision !== "keep_synchronous") process.exitCode = 1;
}

async function reconstructSourceSection(sourceSection, sourceCommitSha) {
  if (!Array.isArray(sourceSection?.measurements)) throw new Error("source section measurements are missing");
  const entries = [];
  for (const measurement of sourceSection.measurements) {
    const artifact = measurement?.artifacts?.[0];
    const bytes = await readGovernedArtifact(artifact?.path);
    const probe = JSON.parse(bytes.toString("utf8"));
    const suffix = ` ${probe.metric}`;
    if (typeof measurement.metric !== "string" || !measurement.metric.endsWith(suffix)) {
      throw new Error("source measurement label does not match its probe metric");
    }
    entries.push({
      label: measurement.metric.slice(0, -suffix.length),
      path: artifact.path,
      bytes
    });
  }
  return buildCapacitySourceSection(entries, sourceCommitSha);
}

function changedPathsAcross(sourceCommitSha, evidenceCommitSha, targetCommitSha) {
  const paths = [
    ...changedPaths(sourceCommitSha, evidenceCommitSha),
    ...changedPaths(evidenceCommitSha, targetCommitSha)
  ];
  return [...new Set(paths)].sort();
}

function changedPaths(sourceCommitSha, targetCommitSha) {
  const output = execFileSync(
    "git",
    ["log", "--format=", "--name-only", "--no-renames", "-m", "--ancestry-path", `${sourceCommitSha}..${targetCommitSha}`, "--"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
  );
  return output.split("\n").filter(Boolean);
}

async function readGovernedArtifact(path) {
  const root = await governedArtifactRoot();
  const candidate = resolve(path);
  const resolved = await realpath(candidate);
  const pathFromRoot = relative(root, resolved);
  const metadata = await lstat(candidate);
  if (pathFromRoot.startsWith(`..${sep}`)
    || pathFromRoot === ".."
    || pathFromRoot === ""
    || metadata.isSymbolicLink()
    || !metadata.isFile()) {
    throw new Error("capacity artifact must be a regular file under artifacts/stage-13-20");
  }
  return readFile(resolved);
}

async function writeGovernedArtifact(path, value) {
  const root = await governedArtifactRoot();
  const candidate = resolve(path);
  await mkdir(dirname(candidate), { recursive: true });
  const parent = await realpath(dirname(candidate));
  const pathFromRoot = relative(root, parent);
  if (pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === "..") {
    throw new Error("capacity output must stay under artifacts/stage-13-20");
  }
  try {
    if ((await lstat(candidate)).isSymbolicLink()) throw new Error("capacity output must not be a symbolic link");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  await writeFile(candidate, bytes, { mode: 0o600 });
  return { path: normalizeRepoPath(path), sha256: sha256(bytes) };
}

async function governedArtifactRoot() {
  const root = resolve("artifacts/stage-13-20");
  await mkdir(root, { recursive: true });
  return realpath(root);
}

function requireCommittedBytes(commitSha, path, expectedBytes) {
  let committedBytes;
  try {
    committedBytes = execFileSync("git", ["show", `${commitSha}:${path}`], {
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"]
    });
  } catch {
    throw new Error(`artifact is not committed at ${commitSha}: ${path}`);
  }
  if (!expectedBytes.equals(committedBytes)) throw new Error(`artifact bytes changed at ${commitSha}: ${path}`);
}

function requireExactHead(commitSha) {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (head !== commitSha) throw new Error(`requested commit ${commitSha} is not the exact current HEAD ${head}`);
}

function requireTrackedWorktreeClean() {
  const unstaged = execFileSync("git", ["-c", "core.fsmonitor=false", "diff", "--name-only"], { encoding: "utf8" }).trim();
  const staged = execFileSync("git", ["-c", "core.fsmonitor=false", "diff", "--cached", "--name-only"], { encoding: "utf8" }).trim();
  if (unstaged || staged) throw new Error("tracked worktree changes must be committed before capacity evidence generation");
}

function requireAncestor(sourceCommitSha, targetCommitSha) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", sourceCommitSha, targetCommitSha], { stdio: "ignore" });
  } catch {
    throw new Error(`${sourceCommitSha} is not an ancestor of ${targetCommitSha}`);
  }
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

function requiredSingle(options, name) {
  const values = options.get(name) ?? [];
  if (values.length !== 1) throw new Error(`exactly one --${name} is required`);
  return values[0];
}

function normalizeRepoPath(path) {
  return relative(process.cwd(), resolve(path)).split(sep).join("/");
}

function summarizeMeasurement(measurement) {
  return {
    metric: measurement.metric,
    environment: measurement.environment,
    observed: measurement.observed,
    threshold: measurement.threshold,
    sampleSize: measurement.sampleSize,
    failures: measurement.failures,
    breached: measurement.breached,
    measuredAt: measurement.measuredAt
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function printUsage() {
  console.log(`Usage:
  node scripts/async-capacity-evidence.mjs source --commit <S> --output <path> --measurement <label=probe-path> [--measurement ...]
  node scripts/async-capacity-evidence.mjs target --source-section <path> --source-commit <S> --evidence-commit <R> --target-commit <T> --output <path>`);
}
