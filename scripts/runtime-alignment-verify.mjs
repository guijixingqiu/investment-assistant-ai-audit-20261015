#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const failures = [];
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const dockerfile = readFileSync("Dockerfile.staging", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

assert("process runs on Node 24", process.versions.node.split(".")[0] === "24", process.versions.node);
assert("package engines require Node 24", packageJson.engines?.node === ">=24 <25", packageJson.engines?.node);
assert("developer version file selects Node 24", readFileSync(".nvmrc", "utf8").trim() === "24", ".nvmrc");
assert("lockfile binds the same package and engine", packageLock.name === packageJson.name
  && packageLock.packages?.[""]?.name === packageJson.name
  && packageLock.packages?.[""]?.engines?.node === packageJson.engines.node, "package-lock.json");
assert("all Docker stages use Node 24", (dockerfile.match(/^FROM node:24-/gm) ?? []).length === 3, "Dockerfile.staging");
assert("CI installs and verifies on Node 24", workflow.includes('node-version: "24"')
  && workflow.includes("run: npm ci")
  && workflow.includes("run: npm run runtime-alignment-verify"), ".github/workflows/ci.yml");

if (failures.length === 0) {
  const firstBuildHash = buildAndHash();
  const secondBuildHash = buildAndHash();
  assert("repeated lockfile build output is byte-identical", firstBuildHash === secondBuildHash, { firstBuildHash, secondBuildHash });
}

const result = {
  ok: failures.length === 0,
  node: process.versions.node,
  npm: process.env.npm_config_user_agent ?? "unknown",
  distHash: failures.length === 0 ? hashDirectory("dist") : null,
  failures
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);

function buildAndHash() {
  rmSync("dist", { recursive: true, force: true });
  const npmExecPath = process.env.npm_execpath;
  if (!npmExecPath) throw new Error("runtime alignment verify must run through npm");
  execFileSync(process.execPath, [npmExecPath, "run", "build"], { stdio: "ignore" });
  return hashDirectory("dist");
}

function hashDirectory(directory) {
  const hash = createHash("sha256");
  for (const path of files(directory).sort()) {
    hash.update(relative(directory, path));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function files(directory) {
  const output = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) output.push(...files(path));
    else output.push(path);
  }
  return output;
}

function assert(id, ok, evidence) {
  if (!ok) failures.push({ id, evidence });
}
