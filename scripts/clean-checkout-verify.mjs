import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const sourceRoot = process.cwd();
const workRoot = await mkdtemp(path.join(os.tmpdir(), "annual-rings-clean-"));
const checkout = path.join(workRoot, "repo");

try {
  await run("git", ["clone", "--quiet", "--no-local", sourceRoot, checkout], { cwd: workRoot });
  const head = await run("git", ["rev-parse", "HEAD"], { cwd: checkout, silent: true });
  console.log(`clean checkout HEAD ${head.stdout.trim()}`);

  await run("npm", ["ci"], { cwd: checkout });
  await run("make", ["verify"], { cwd: checkout, timeoutMs: 180_000 });
  console.log("Clean checkout verify passed.");
} finally {
  await rm(workRoot, { recursive: true, force: true });
}

async function run(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    cwd: options.cwd ?? sourceRoot,
    env: process.env,
    maxBuffer: 40 * 1024 * 1024,
    timeout: options.timeoutMs ?? 120_000
  });
  if (!options.silent) {
    if (result.stdout.trim()) {
      console.log(result.stdout.trim());
    }
    if (result.stderr.trim()) {
      console.error(result.stderr.trim());
    }
  }
  return result;
}
