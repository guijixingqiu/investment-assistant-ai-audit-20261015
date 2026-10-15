#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const maxWarningsArg = process.argv.find((argument) => argument.startsWith("--max-warnings="));
const maxWarnings = maxWarningsArg === undefined ? Number.POSITIVE_INFINITY : Number(maxWarningsArg.split("=")[1]);
if (!Number.isInteger(maxWarnings) && maxWarnings !== Number.POSITIVE_INFINITY || maxWarnings < 0) {
  console.error("--max-warnings must be a non-negative integer");
  process.exit(2);
}

const allowlistPath = path.join(root, ".github", "risk-scan-allowlist.json");
const allowlist = fs.existsSync(allowlistPath)
  ? JSON.parse(fs.readFileSync(allowlistPath, "utf8"))
  : [];

const excludedParts = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".venv",
  "venv",
  "artifacts",
  "audit",
]);
const excludedFiles = new Set(["scripts/ci-risk-scan.mjs"]);

const securityRules = [
  ["unlock_trade", /\bunlock_trade\b/i],
  ["place_order", /\bplace_order\b/i],
  ["submit_order", /\bsubmit_order\b/i],
  ["trade_password", /\btrade[_-]?password\b/i],
  ["private_key", /\bprivate[_-]?key\b/i],
  ["client_secret", /\bclient[_-]?secret\b/i],
  ["real_broker", /\breal_broker\b/i],
  ["tls_disabled", /\bNODE_TLS_REJECT_UNAUTHORIZED\s*=\s*0\b/],
];

const quantRules = [
  ["shift_negative", /shift\s*\(\s*-/],
  ["centered_rolling", /center\s*=\s*True\b/],
  ["backfill", /\bbfill\s*\(/],
  ["future_iloc", /iloc\s*\[\s*i\s*\+/],
];

const docsPattern = /(^|\/)(CHANGELOG\.md|STATUS\.md|PROJECT\.md|README\.md|AGENTS\.md|docs\/|deploy\/.*\.md)/;
const codePattern = /\.(mjs|js|ts|tsx|py|swift|sql|sh|yml|yaml|json|toml)$/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (dir === root && entry.name === ".ai-bridge") continue;
    if (excludedParts.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (entry.isDirectory()) {
      walk(absolute, out);
    } else if (entry.isFile()) {
      out.push(relative);
    }
  }
  return out;
}

function isAllowed(hit) {
  return allowlist.some((item) => {
    return (
      item.file === hit.file &&
      item.rule === hit.rule &&
      (item.line === undefined || item.line === hit.line) &&
      typeof item.reason === "string" &&
      item.reason.trim().length >= 12
    );
  });
}

const hits = [];
for (const file of walk(root)) {
  if (excludedFiles.has(file)) continue;

  const absolute = path.join(root, file);
  const stat = fs.statSync(absolute);
  if (stat.size > 2_000_000) continue;

  const buffer = fs.readFileSync(absolute);
  if (buffer.includes(0)) continue;

  const lines = buffer.toString("utf8").split(/\r?\n/);
  const rules = [...securityRules, ...quantRules];

  lines.forEach((line, index) => {
    for (const [rule, pattern] of rules) {
      if (!pattern.test(line)) continue;
      const hit = {
        file,
        line: index + 1,
        rule,
        severity: docsPattern.test(file) ? "warning" : "error",
      };
      if (isAllowed(hit)) continue;
      if (!codePattern.test(file) && !docsPattern.test(file)) continue;
      hits.push(hit);
    }
  });
}

const errors = hits.filter((hit) => hit.severity === "error");
const warnings = hits.filter((hit) => hit.severity === "warning");
for (const hit of hits) {
  console.log(`${hit.severity}\t${hit.file}:${hit.line}\t${hit.rule}`);
}

if (errors.length > 0) {
  console.error(
    `Risk scan found ${errors.length} code-level high-risk pattern(s). ` +
      "Add a reviewed allowlist entry with a reason if intentional."
  );
  process.exit(1);
}

if (warnings.length > maxWarnings) {
  console.error(`Risk scan found ${warnings.length} warning(s), exceeding --max-warnings=${maxWarnings}.`);
  process.exit(1);
}

console.log(`Risk scan completed with ${warnings.length} warning(s) and 0 error(s).`);
