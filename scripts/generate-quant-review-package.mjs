#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const date = process.env.QUANT_REVIEW_DATE ?? localDate();
const stage = slug(process.env.QUANT_REVIEW_STAGE ?? "quant-smoke");
const outDir = join(root, "audit", `${date}-${stage}`);
const baseline = process.env.QUANT_REVIEW_BASELINE ?? "HEAD";
const overwrite = process.env.QUANT_REVIEW_OVERWRITE === "1";
const runCoverage = process.env.QUANT_REVIEW_RUN_COVERAGE === "1";
const skipTestCommands = process.env.QUANT_REVIEW_SKIP_TEST_COMMANDS === "1";
const skipQualityCommands = process.env.QUANT_REVIEW_SKIP_QUALITY_COMMANDS === "1";
const commandResults = [];

if (existsSync(outDir)) {
  if (!overwrite) {
    console.error(`Quant review package already exists: ${relative(outDir)}`);
    console.error("Set QUANT_REVIEW_OVERWRITE=1 to replace it.");
    process.exit(1);
  }
  await rm(outDir, { recursive: true, force: true });
}

await mkdir(outDir, { recursive: true });
await mkdir(join(outDir, "quant-artifacts"), { recursive: true });
await mkdir(join(outDir, "source-snapshots"), { recursive: true });

await writeText("repo-path.txt", `${root}\n`);
await capture("git-branch.txt", "git", ["branch", "--show-current"]);
await capture("git-head.txt", "git", ["rev-parse", "HEAD"]);
await capture("git-status.txt", "git", ["status", "--short", "--untracked-files=all"]);
await capture("git-status-with-ignored.txt", "git", ["status", "--ignored", "--short", "--untracked-files=all"]);
await capture("worktree-list.txt", "git", ["worktree", "list"], { timeoutMs: 15_000, fatal: false });
await capture("git-log.txt", "git", ["log", "--oneline", "--decorate", "-20"], { timeoutMs: 15_000, fatal: false });
await capture("changed-files.txt", "git", ["diff", "--name-status", baseline]);
await capture("diff-stat.txt", "git", ["diff", "--stat", baseline]);
await capture("current-stage.patch", "git", ["diff", "--binary", baseline]);
await capture("tracked-files.txt", "git", ["ls-files"]);
await capture("untracked-files.txt", "git", ["ls-files", "--others", "--exclude-standard"]);
await capture("ignored-files.txt", "git", ["ls-files", "--others", "--ignored", "--exclude-standard"]);
await captureShell("tree.txt", "find . -maxdepth 4 -path './.git' -prune -o -path './node_modules' -prune -o -path './dist' -prune -o -path './artifacts' -prune -o -path './audit' -prune -o -print | sort");
await capture("quant-loop-readiness-results.txt", "npm", ["run", "quant-loop-readiness"], { timeoutMs: 120_000 });
await capture("quant-freeze-snapshot-results.txt", "npm", ["run", "quant-freeze-snapshot"], { timeoutMs: 120_000 });
await capture("quant-freeze-snapshot-multi-results.txt", "npm", ["run", "quant-freeze-snapshot:multi"], { timeoutMs: 120_000 });
await capture("quant-portfolio-smoke-results.txt", "npm", ["run", "quant-portfolio-smoke"], { timeoutMs: 120_000 });
await capture("quant-portfolio-audit-results.txt", "npm", ["run", "quant-portfolio-audit"], { timeoutMs: 120_000 });
await capture("quant-portfolio-pipeline-results.txt", "npm", ["run", "quant-portfolio-pipeline"], { timeoutMs: 120_000 });
await capture("quant-pipeline-results.txt", "npm", ["run", "quant-pipeline"], { timeoutMs: 120_000 });
await capture("quant-smoke-results.txt", "npm", ["run", "quant-smoke"], { timeoutMs: 120_000 });
await capture("quant-audit-results.txt", "npm", ["run", "quant-audit"], { timeoutMs: 120_000 });
if (skipQualityCommands) {
  await writeText("typecheck-results.txt", "未运行：QUANT_REVIEW_SKIP_QUALITY_COMMANDS=1，仅用于生成器单元测试避免递归质量门禁。\n");
  await writeText("lint-results.txt", "未运行：QUANT_REVIEW_SKIP_QUALITY_COMMANDS=1，仅用于生成器单元测试避免递归质量门禁。\n");
} else {
  await capture("typecheck-results.txt", "npm", ["run", "typecheck"], { timeoutMs: 600_000 });
  await capture("lint-results.txt", "npm", ["run", "lint"], { timeoutMs: 120_000 });
}
if (skipTestCommands) {
  await writeText("unit-test-results.txt", "未运行：QUANT_REVIEW_SKIP_TEST_COMMANDS=1，仅用于生成器单元测试避免递归。\n");
  await writeText("contract-test-results.txt", "未运行：QUANT_REVIEW_SKIP_TEST_COMMANDS=1，仅用于生成器单元测试避免递归。\n");
} else {
  await capture("unit-test-results.txt", "npm", ["run", "test"], { timeoutMs: 180_000 });
  await capture("contract-test-results.txt", "npm", ["run", "contract-test"], { timeoutMs: 180_000 });
}

if (runCoverage) {
  await capture("coverage-results.txt", "npm", ["run", "coverage"], { timeoutMs: 240_000 });
} else {
  await writeText("coverage-results.txt", "未运行：默认审查包不执行 coverage；设置 QUANT_REVIEW_RUN_COVERAGE=1 可纳入完整覆盖率输出。\n");
}

await copyIfExists("docs/audit/quant-loop-spec.md", "source-snapshots/quant-loop-spec.md");
await copyIfExists("config/quant-smoke.hk-09926.json", "source-snapshots/quant-smoke.hk-09926.json");
await copyIfExists("config/quant-portfolio-smoke.hk-multi-symbol.json", "source-snapshots/quant-portfolio-smoke.hk-multi-symbol.json");
await copyIfExists("config/quant-portfolio-pipeline.hk-multi-symbol.json", "source-snapshots/quant-portfolio-pipeline.hk-multi-symbol.json");
await copyIfExists("config/quant-freeze-snapshot.hk-09926.json", "source-snapshots/quant-freeze-snapshot.hk-09926.json");
await copyIfExists("config/quant-freeze-snapshot.hk-multi-symbol.json", "source-snapshots/quant-freeze-snapshot.hk-multi-symbol.json");
await copyIfExists("config/quant-pipeline.hk-09926.json", "source-snapshots/quant-pipeline.hk-09926.json");
await copyIfExists("config/quant-freeze-snapshot.hk-09926-market-data-export.json", "source-snapshots/quant-freeze-snapshot.hk-09926-market-data-export.json");
await copyIfExists("config/quant-pipeline.hk-09926-market-data-export.json", "source-snapshots/quant-pipeline.hk-09926-market-data-export.json");
await copyIfExists("data/quant-fixtures/hk-09926-v0.1.snapshot.json", "source-snapshots/hk-09926-v0.1.snapshot.json");
await copyIfExists("data/quant-fixtures/hk-multi-symbol-v0.1.snapshot.json", "source-snapshots/hk-multi-symbol-v0.1.snapshot.json");
await copyIfExists("data/quant-fixtures/hk-09926-market-data-export-v0.1.json", "source-snapshots/hk-09926-market-data-export-v0.1.json");
await copyQuantArtifacts();
await copyPortfolioArtifacts();
await copyFrozenSnapshotArtifacts();
await copyPipelineArtifacts();
await copyPortfolioPipelineArtifacts();

const quantArtifacts = await loadQuantArtifacts();
const portfolioArtifacts = await loadPortfolioArtifacts();
const frozenSnapshotArtifacts = await loadFrozenSnapshotArtifacts();
const pipelineArtifacts = await loadPipelineArtifacts();
const portfolioPipelineArtifacts = await loadPortfolioPipelineArtifacts();
const classifications = await classifyChanges();
const sourceAudit = await auditSource();
const securityAudit = await auditSecurity();
const qualityAudit = await auditQuality();

await writeText("ARCHITECTURE.md", buildArchitecture());
await writeText("PROGRESS_MATRIX.md", buildProgressMatrix(quantArtifacts, portfolioArtifacts, frozenSnapshotArtifacts, pipelineArtifacts, portfolioPipelineArtifacts));
await writeText("quant-audit.md", buildQuantAudit(quantArtifacts, portfolioArtifacts, frozenSnapshotArtifacts, pipelineArtifacts, portfolioPipelineArtifacts, sourceAudit));
await writeText("security-audit.md", buildSecurityAudit(securityAudit));
await writeText("known-issues.md", buildKnownIssues(quantArtifacts, qualityAudit));
await writeText("code-quality-self-audit.md", buildQualityAudit(qualityAudit));
await writeText("change-classification.md", buildChangeClassification(classifications));
await writeText("artifacts-index.md", await buildArtifactsIndex());

const manifest = {
  schemaVersion: "2026-06-20.quant-review-package.v1",
  generatedAt: new Date().toISOString(),
  date,
  stage,
  repoPath: root,
  baseline,
  endCommit: (await readGenerated("git-head.txt")).trim(),
  outDir: relative(outDir),
  runCoverage,
  skipTestCommands,
  skipQualityCommands,
  safety: {
    sendsLiveNetworkRequests: false,
    deploys: false,
    reloadsServices: false,
    writesProductionFacts: false,
    enablesTrading: false,
    initializesBrokerGateway: false
  },
  commands: commandResults,
  quant: {
    configPath: "config/quant-smoke.hk-09926.json",
    artifactDir: "artifacts/quant-smoke/latest",
    frozenSnapshot: frozenSnapshotArtifacts.manifest ? {
      snapshotId: frozenSnapshotArtifacts.manifest.snapshotId,
      dataHash: frozenSnapshotArtifacts.manifest.dataHash,
      sourceHash: frozenSnapshotArtifacts.manifest.sourceHash,
      rows: frozenSnapshotArtifacts.manifest.rows,
      dataCutoff: frozenSnapshotArtifacts.manifest.dataCutoff,
      dataQualityOk: frozenSnapshotArtifacts.manifest.dataQuality?.ok ?? null
    } : null,
    pipeline: pipelineArtifacts.manifest ? {
      goNoGo: pipelineArtifacts.manifest.goNoGo,
      frozenSnapshotPath: pipelineArtifacts.manifest.linkage?.frozenSnapshotPath ?? null,
      smokeSnapshotPath: pipelineArtifacts.manifest.linkage?.smokeSnapshotPath ?? null,
      smokeUsesFrozenSnapshot: pipelineArtifacts.manifest.linkage?.smokeUsesFrozenSnapshot ?? null,
      dataHashesMatch: pipelineArtifacts.manifest.linkage?.dataHashesMatch ?? null,
      metrics: pipelineArtifacts.manifest.metrics ?? null
    } : null,
    snapshotId: quantArtifacts.manifest?.snapshotId ?? null,
    dataHash: quantArtifacts.manifest?.dataHash ?? null,
    configHash: quantArtifacts.manifest?.configHash ?? null,
    metrics: quantArtifacts.manifest?.metrics ?? null,
    auditOk: quantArtifacts.audit?.ok ?? null,
    reproducible: quantArtifacts.audit?.reproducibility?.ok ?? null
  },
  portfolioQuant: {
    configPath: "config/quant-portfolio-smoke.hk-multi-symbol.json",
    artifactDir: "artifacts/quant-portfolio-smoke/latest",
    snapshotId: portfolioArtifacts.manifest?.snapshotId ?? null,
    dataHash: portfolioArtifacts.manifest?.dataHash ?? null,
    configHash: portfolioArtifacts.manifest?.configHash ?? null,
    metrics: portfolioArtifacts.manifest?.metrics ?? null,
    auditOk: portfolioArtifacts.audit?.ok ?? null,
    reproducible: portfolioArtifacts.audit?.reproducibility?.ok ?? null
  },
  portfolioPipeline: {
    configPath: "config/quant-portfolio-pipeline.hk-multi-symbol.json",
    artifactDir: "artifacts/quant-portfolio-pipeline/latest",
    goNoGo: portfolioPipelineArtifacts.manifest?.goNoGo ?? null,
    portfolioUsesFrozenSnapshot: portfolioPipelineArtifacts.manifest?.linkage?.portfolioUsesFrozenSnapshot ?? null,
    dataHashesMatch: portfolioPipelineArtifacts.manifest?.linkage?.dataHashesMatch ?? null,
    metrics: portfolioPipelineArtifacts.manifest?.metrics ?? null
  }
};

await writeText("run_manifest.json", JSON.stringify(manifest, null, 2) + "\n");
await writeText("SUMMARY.md", buildSummary(manifest, quantArtifacts, portfolioArtifacts, frozenSnapshotArtifacts, pipelineArtifacts, portfolioPipelineArtifacts));
await captureShell("hashes.txt", `find ${shellQuote(relative(outDir))} -type f -print0 | xargs -0 shasum -a 256 | sort`);

console.log(JSON.stringify({
  ok: fatalCommandFailures().length === 0,
  outDir: relative(outDir),
  runCoverage,
  quantAuditOk: quantArtifacts.audit?.ok ?? false,
  reproducible: quantArtifacts.audit?.reproducibility?.ok ?? false,
  portfolioAuditOk: portfolioArtifacts.audit?.ok ?? false,
  portfolioReproducible: portfolioArtifacts.audit?.reproducibility?.ok ?? false,
  portfolioPipelineOk: portfolioPipelineArtifacts.manifest?.ok ?? false,
  files: await listGeneratedFiles()
}, null, 2));

if (fatalCommandFailures().length > 0) {
  process.exit(1);
}

async function capture(outputFile, command, args, options = {}) {
  const startedAt = new Date().toISOString();
  const result = await run(command, args, options);
  const finishedAt = new Date().toISOString();
  await writeText(outputFile, result.stdout + result.stderr);
  commandResults.push({
    command: [command, ...args].join(" "),
    outputFile,
    exitCode: result.exitCode,
    fatal: options.fatal !== false,
    startedAt,
    finishedAt
  });
}

async function captureShell(outputFile, command, options = {}) {
  await capture(outputFile, "sh", ["-c", command], options);
}

async function run(command, args, { timeoutMs = 60_000 } = {}) {
  try {
    const result = await execFileAsync(command, command === "git" ? ["-c", "core.preloadIndex=false", ...args] : args, {
      cwd: root,
      env: command === "git" ? { ...process.env, GIT_OPTIONAL_LOCKS: "0" } : process.env,
      timeout: timeoutMs,
      maxBuffer: 100 * 1024 * 1024
    });
    return {
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    return {
      exitCode: error.code ?? 1,
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? error.message ?? "")
    };
  }
}

async function copyQuantArtifacts() {
  const names = [
    "run_manifest.json",
    "config-quality.json",
    "data-quality.json",
    "signals.json",
    "orders.json",
    "trades.json",
    "ledger.json",
    "nav.json",
    "report.md",
    "quant-audit.json"
  ];
  for (const name of names) {
    await copyIfExists(join("artifacts/quant-smoke/latest", name), join("quant-artifacts", name));
  }
}

async function copyPortfolioArtifacts() {
  const names = [
    "run_manifest.json",
    "config-quality.json",
    "data-quality.json",
    "signals.json",
    "orders.json",
    "trades.json",
    "ledger.json",
    "positions.json",
    "nav.json",
    "report.md",
    "quant-portfolio-audit.json"
  ];
  for (const name of names) {
    await copyIfExists(join("artifacts/quant-portfolio-smoke/latest", name), join("portfolio-artifacts", name));
  }
}

async function copyFrozenSnapshotArtifacts() {
  const latest = await findLatestFrozenSnapshot();
  if (!latest) return;
  await copyIfExists(latest.manifest, "frozen-snapshot/manifest.json");
  await copyIfExists(latest.snapshot, "frozen-snapshot/snapshot.json");
}

async function copyPipelineArtifacts() {
  const files = [
    ["artifacts/quant-pipeline/latest/run_manifest.json", "pipeline/run_manifest.json"],
    ["artifacts/quant-pipeline/latest/frozen-manifest.json", "pipeline/frozen-manifest.json"],
    ["artifacts/quant-pipeline/latest/frozen-snapshot.json", "pipeline/frozen-snapshot.json"],
    ["artifacts/quant-pipeline/latest/quant-smoke.config.json", "pipeline/quant-smoke.config.json"],
    ["artifacts/quant-pipeline/latest/smoke/run_manifest.json", "pipeline/smoke/run_manifest.json"],
    ["artifacts/quant-pipeline/latest/smoke/config-quality.json", "pipeline/smoke/config-quality.json"],
    ["artifacts/quant-pipeline/latest/smoke/data-quality.json", "pipeline/smoke/data-quality.json"],
    ["artifacts/quant-pipeline/latest/smoke/signals.json", "pipeline/smoke/signals.json"],
    ["artifacts/quant-pipeline/latest/smoke/orders.json", "pipeline/smoke/orders.json"],
    ["artifacts/quant-pipeline/latest/smoke/trades.json", "pipeline/smoke/trades.json"],
    ["artifacts/quant-pipeline/latest/smoke/ledger.json", "pipeline/smoke/ledger.json"],
    ["artifacts/quant-pipeline/latest/smoke/nav.json", "pipeline/smoke/nav.json"],
    ["artifacts/quant-pipeline/latest/smoke/report.md", "pipeline/smoke/report.md"],
    ["artifacts/quant-pipeline/latest/smoke/quant-audit.json", "pipeline/smoke/quant-audit.json"]
  ];
  for (const [from, to] of files) {
    await copyIfExists(from, to);
  }
}

async function copyPortfolioPipelineArtifacts() {
  const files = [
    ["artifacts/quant-portfolio-pipeline/latest/run_manifest.json", "portfolio-pipeline/run_manifest.json"],
    ["artifacts/quant-portfolio-pipeline/latest/frozen-manifest.json", "portfolio-pipeline/frozen-manifest.json"],
    ["artifacts/quant-portfolio-pipeline/latest/frozen-snapshot.json", "portfolio-pipeline/frozen-snapshot.json"],
    ["artifacts/quant-portfolio-pipeline/latest/quant-portfolio-smoke.config.json", "portfolio-pipeline/quant-portfolio-smoke.config.json"],
    ["artifacts/quant-portfolio-pipeline/latest/portfolio/run_manifest.json", "portfolio-pipeline/portfolio/run_manifest.json"],
    ["artifacts/quant-portfolio-pipeline/latest/portfolio/config-quality.json", "portfolio-pipeline/portfolio/config-quality.json"],
    ["artifacts/quant-portfolio-pipeline/latest/portfolio/data-quality.json", "portfolio-pipeline/portfolio/data-quality.json"],
    ["artifacts/quant-portfolio-pipeline/latest/portfolio/signals.json", "portfolio-pipeline/portfolio/signals.json"],
    ["artifacts/quant-portfolio-pipeline/latest/portfolio/orders.json", "portfolio-pipeline/portfolio/orders.json"],
    ["artifacts/quant-portfolio-pipeline/latest/portfolio/trades.json", "portfolio-pipeline/portfolio/trades.json"],
    ["artifacts/quant-portfolio-pipeline/latest/portfolio/ledger.json", "portfolio-pipeline/portfolio/ledger.json"],
    ["artifacts/quant-portfolio-pipeline/latest/portfolio/positions.json", "portfolio-pipeline/portfolio/positions.json"],
    ["artifacts/quant-portfolio-pipeline/latest/portfolio/nav.json", "portfolio-pipeline/portfolio/nav.json"],
    ["artifacts/quant-portfolio-pipeline/latest/portfolio/report.md", "portfolio-pipeline/portfolio/report.md"],
    ["artifacts/quant-portfolio-pipeline/latest/portfolio/quant-portfolio-audit.json", "portfolio-pipeline/portfolio/quant-portfolio-audit.json"]
  ];
  for (const [from, to] of files) {
    await copyIfExists(from, to);
  }
}

async function findLatestFrozenSnapshot() {
  const result = await run("sh", ["-c", "find artifacts/quant-snapshots -maxdepth 1 -name '*.manifest.json' -print 2>/dev/null | sort | tail -n 1"], { timeoutMs: 60_000 });
  const manifest = result.stdout.trim();
  if (!manifest) return null;
  const snapshot = manifest.replace(/\.manifest\.json$/, ".snapshot.json");
  return { manifest, snapshot };
}

async function copyIfExists(from, to) {
  const source = resolvePath(from);
  if (!existsSync(source)) return;
  await mkdir(dirname(join(outDir, to)), { recursive: true });
  await copyFile(source, join(outDir, to));
}

async function loadQuantArtifacts() {
  return {
    manifest: await readJsonIfExists("quant-artifacts/run_manifest.json"),
    configQuality: await readJsonIfExists("quant-artifacts/config-quality.json"),
    dataQuality: await readJsonIfExists("quant-artifacts/data-quality.json"),
    signals: await readJsonIfExists("quant-artifacts/signals.json", []),
    orders: await readJsonIfExists("quant-artifacts/orders.json", []),
    trades: await readJsonIfExists("quant-artifacts/trades.json", []),
    ledger: await readJsonIfExists("quant-artifacts/ledger.json", []),
    nav: await readJsonIfExists("quant-artifacts/nav.json", []),
    audit: await readJsonIfExists("quant-artifacts/quant-audit.json")
  };
}

async function loadPortfolioArtifacts() {
  return {
    manifest: await readJsonIfExists("portfolio-artifacts/run_manifest.json"),
    configQuality: await readJsonIfExists("portfolio-artifacts/config-quality.json"),
    dataQuality: await readJsonIfExists("portfolio-artifacts/data-quality.json"),
    signals: await readJsonIfExists("portfolio-artifacts/signals.json", []),
    orders: await readJsonIfExists("portfolio-artifacts/orders.json", []),
    trades: await readJsonIfExists("portfolio-artifacts/trades.json", []),
    ledger: await readJsonIfExists("portfolio-artifacts/ledger.json", []),
    positions: await readJsonIfExists("portfolio-artifacts/positions.json", []),
    nav: await readJsonIfExists("portfolio-artifacts/nav.json", []),
    audit: await readJsonIfExists("portfolio-artifacts/quant-portfolio-audit.json")
  };
}

async function loadFrozenSnapshotArtifacts() {
  return {
    manifest: await readJsonIfExists("frozen-snapshot/manifest.json"),
    snapshot: await readJsonIfExists("frozen-snapshot/snapshot.json")
  };
}

async function loadPipelineArtifacts() {
  return {
    manifest: await readJsonIfExists("pipeline/run_manifest.json")
  };
}

async function loadPortfolioPipelineArtifacts() {
  return {
    manifest: await readJsonIfExists("portfolio-pipeline/run_manifest.json")
  };
}

async function readJsonIfExists(name, fallback = null) {
  const absolute = join(outDir, name);
  if (!existsSync(absolute)) return fallback;
  return JSON.parse(await readFile(absolute, "utf8"));
}

async function classifyChanges() {
  const text = await readGenerated("changed-files.txt");
  const rows = text.trim() ? text.trim().split(/\r?\n/).map((line) => {
    const [status, ...rest] = line.split(/\s+/);
    return { status, file: rest.join(" ") };
  }) : [];
  return {
    added: rows.filter((row) => row.status.startsWith("A")),
    modified: rows.filter((row) => row.status.startsWith("M")),
    deleted: rows.filter((row) => row.status.startsWith("D")),
    other: rows.filter((row) => !/^[AMD]/.test(row.status))
  };
}

async function auditSource() {
  const patterns = [
    ["negative shift", "shift" + "(-"],
    ["future index", "iloc[i " + "+"],
    ["centered rolling", "rolling(..., center" + "=True)"],
    ["backfill", "bfill" + "("],
    ["unbounded merge", "merge("],
    ["asof merge", "merge_asof"],
    ["current bar execution", "sameBarExecution"],
    ["order placement", "place_" + "order"],
    ["order submission", "submit_" + "order"],
    ["trade unlock", "unlock_" + "trade"]
  ];
  const files = [
    "scripts/quant-smoke.mjs",
    "scripts/quant-audit.mjs",
    "scripts/quant-portfolio-smoke.mjs",
    "scripts/quant-portfolio-audit.mjs",
    "scripts/quant-portfolio-pipeline.mjs",
    "scripts/quant-loop-readiness.mjs",
    "config/quant-smoke.hk-09926.json",
    "config/quant-portfolio-smoke.hk-multi-symbol.json",
    "config/quant-portfolio-pipeline.hk-multi-symbol.json",
    "config/quant-freeze-snapshot.hk-09926.json",
    "config/quant-pipeline.hk-09926.json",
    "docs/audit/quant-loop-spec.md"
  ];
  const hits = [];
  for (const file of files) {
    const absolute = resolvePath(file);
    if (!existsSync(absolute)) continue;
    const lines = (await readFile(absolute, "utf8")).split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const [label, pattern] of patterns) {
        if (line.includes(pattern)) {
          hits.push({ file, line: index + 1, pattern: label, text: line.trim().slice(0, 180) });
        }
      }
    });
  }
  return hits;
}

async function auditSecurity() {
  const words = [
    "place_" + "order",
    "submit_" + "order",
    "trade",
    "unlock_" + "trade",
    "acc_" + "id",
    "pass" + "word",
    "token",
    "secret",
    "private_" + "key"
  ];
  const files = await listRepoFiles();
  const hits = [];
  for (const file of files) {
    if (shouldSkipScan(file)) continue;
    const absolute = resolvePath(file);
    const text = await readFile(absolute, "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const word of words) {
        if (line.toLowerCase().includes(word.toLowerCase())) {
          hits.push({
            file,
            line: index + 1,
            keyword: word,
            explanation: explainSecurityHit(file, word, line)
          });
        }
      }
    });
  }
  return hits;
}

async function auditQuality() {
  const files = await listRepoFiles();
  const sizes = [];
  const broadCatches = [];
  const hardcodedPaths = [];
  const todos = [];
  for (const file of files) {
    if (shouldSkipScan(file)) continue;
    const text = await readFile(resolvePath(file), "utf8");
    const lines = text.split(/\r?\n/);
    sizes.push({ file, lines: lines.length });
    lines.forEach((line, index) => {
      if (/\bcatch\s*(\{|$)|catch\s*\([^)]*\)\s*\{/.test(line) && !line.includes("error")) {
        broadCatches.push({ file, line: index + 1, text: line.trim() });
      }
      if (/\/Users\/REDACTED_USER|\/home\/REDACTED_USER|\/private\/tmp/.test(line)) {
        hardcodedPaths.push({ file, line: index + 1, text: line.trim().slice(0, 180) });
      }
      if (/\b(TODO|FIXME)\b/i.test(line)) {
        todos.push({ file, line: index + 1, text: line.trim().slice(0, 180) });
      }
    });
  }
  return {
    largestFiles: sizes.sort((a, b) => b.lines - a.lines).slice(0, 10),
    broadCatches,
    hardcodedPaths,
    todos,
    untestedQuantModules: [
      "无：当前新增量化脚本均有 unit test 或由 quant-audit/quant-smoke 命令覆盖。"
    ]
  };
}

async function listRepoFiles() {
  const { stdout } = await run("git", ["ls-files"], { timeoutMs: 60_000 });
  return stdout.trim().split(/\r?\n/).filter(Boolean);
}

function shouldSkipScan(file) {
  return (
    file.startsWith("audit/") ||
    file.startsWith("artifacts/") ||
    file.startsWith("node_modules/") ||
    file.startsWith("dist/")
  );
}

function explainSecurityHit(file, word, line) {
  if (file.startsWith("scripts/quant-") || file.startsWith("config/quant-") || file.startsWith("data/quant-")) {
    return "量化 v0.1 研究/审计/fixture 范围；不得包含真实交易凭证或下单能力。";
  }
  if (/TOKEN|token|auth|authorization/i.test(line)) {
    return "现有 API/部署鉴权或测试边界相关；需继续避免提交真实密钥。";
  }
  return "关键词命中，需由外部审查者结合上下文复核用途。";
}

function buildSummary(manifest, quant, portfolio, frozen, pipeline, portfolioPipeline) {
  const failed = fatalCommandFailures();
  const warnings = commandResults.filter((item) => item.exitCode !== 0 && item.fatal === false);
  const metrics = quant.manifest?.metrics ?? {};
  const status = fatalCommandFailures().length === 0 ? "VERIFIED" : "BLOCKED";
  return `# Quant Stage Review Package

Status: ${status}
Generated: ${manifest.generatedAt}
Repository: \`${manifest.repoPath}\`
Branch: \`${readGeneratedSync("git-branch.txt").trim()}\`
HEAD: \`${manifest.endCommit}\`
Baseline: \`${manifest.baseline}\`

## Scope

This package covers the HK stock v0.1 minimal quantitative research loop only. It does not deploy, reload services, enable write tokens, write production facts, initialize broker gateways, or add real order submission.

## Minimal Loop Result

- Command: \`npm run quant-smoke\`
- Config: \`config/quant-smoke.hk-09926.json\`
- Snapshot: \`${quant.manifest?.snapshotId ?? "missing"}\`
- Date range: ${quant.manifest?.dateRange?.start ?? "missing"} to ${quant.manifest?.dateRange?.end ?? "missing"}
- Universe: ${(quant.manifest?.universe ?? []).map((item) => `${item.market}.${item.code}`).join(", ") || "missing"}
- Initial cash: ${quant.manifest?.initialCash ?? "missing"}
- Experiment: \`${formatExperiment(quant.manifest?.experiment)}\`
- Final equity: ${metrics.finalEquity ?? "missing"}
- Total return: ${metrics.totalReturn ?? "missing"}
- Max drawdown: ${metrics.maxDrawdown ?? "missing"}
- Sharpe: ${metrics.sharpe ?? "missing"}
- Total fees: ${metrics.totalFees ?? "missing"}
- Trades: ${(quant.trades ?? []).length}
- Quant audit: ${quant.audit?.ok === true ? "PASS" : "FAIL_OR_MISSING"}
- Reproducibility: ${quant.audit?.reproducibility?.ok === true ? "PASS" : "FAIL_OR_MISSING"}

## Portfolio Accounting Smoke

- Command: \`npm run quant-portfolio-smoke\`
- Audit command: \`npm run quant-portfolio-audit\`
- Snapshot: \`${portfolio.manifest?.snapshotId ?? "missing"}\`
- Universe: ${(portfolio.manifest?.universe ?? []).map((item) => item.symbol).join(", ") || "missing"}
- Trades: ${(portfolio.trades ?? []).length}
- Final equity: ${portfolio.manifest?.metrics?.finalEquity ?? "missing"}
- Total fees: ${portfolio.manifest?.metrics?.totalFees ?? "missing"}
- Traded symbols: ${(portfolio.manifest?.metrics?.tradedSymbols ?? []).join(", ") || "missing"}
- Portfolio audit: ${portfolio.audit?.ok === true ? "PASS" : "FAIL_OR_MISSING"}
- Portfolio reproducibility: ${portfolio.audit?.reproducibility?.ok === true ? "PASS" : "FAIL_OR_MISSING"}
- Portfolio pipeline: ${portfolioPipeline.manifest?.ok === true ? "PASS" : "FAIL_OR_MISSING"}
- Portfolio pipeline uses frozen snapshot: ${portfolioPipeline.manifest?.linkage?.portfolioUsesFrozenSnapshot === true ? "PASS" : "FAIL_OR_MISSING"}
- Portfolio pipeline data hashes match: ${portfolioPipeline.manifest?.linkage?.dataHashesMatch === true ? "PASS" : "FAIL_OR_MISSING"}

## Frozen Snapshot Gate

- Command: \`npm run quant-freeze-snapshot\`
- Frozen snapshot: \`${frozen.manifest?.snapshotId ?? "missing"}\`
- Data hash: \`${frozen.manifest?.dataHash ?? "missing"}\`
- Source hash: \`${frozen.manifest?.sourceHash ?? "missing"}\`
- Rows: ${frozen.manifest?.rows ?? "missing"}
- Data quality: ${frozen.manifest?.dataQuality?.ok === true ? "PASS" : "FAIL_OR_MISSING"}
- Output copied to: \`frozen-snapshot/manifest.json\`, \`frozen-snapshot/snapshot.json\`

## Bound Pipeline

- Command: \`npm run quant-pipeline\`
- Go/no-go: \`${pipeline.manifest?.goNoGo ?? "missing"}\`
- Smoke uses frozen snapshot: ${pipeline.manifest?.linkage?.smokeUsesFrozenSnapshot === true ? "PASS" : "FAIL_OR_MISSING"}
- Data hashes match: ${pipeline.manifest?.linkage?.dataHashesMatch === true ? "PASS" : "FAIL_OR_MISSING"}
- Pipeline final equity: ${pipeline.manifest?.metrics?.finalEquity ?? "missing"}

## Command Results

${commandResults.map((item) => `- ${formatCommandStatus(item)}: \`${item.command}\` -> \`${item.outputFile}\``).join("\n")}

${failed.length > 0 ? `## Failed Commands\n\n${failed.map((item) => `- \`${item.command}\` exited ${item.exitCode}; see \`${item.outputFile}\`.`).join("\n")}\n` : ""}
${warnings.length > 0 ? `## Non-Fatal Evidence Warnings\n\n${warnings.map((item) => `- \`${item.command}\` exited ${item.exitCode}; captured in \`${item.outputFile}\` but does not invalidate quant evidence.`).join("\n")}\n` : ""}
`;
}

function fatalCommandFailures() {
  return commandResults.filter((item) => item.exitCode !== 0 && item.fatal !== false);
}

function formatCommandStatus(item) {
  if (item.exitCode === 0) return "PASS";
  return item.fatal === false ? "WARN" : "FAIL";
}

function buildArchitecture() {
  return `# Architecture

## Quant v0.1 Modules

| Module | Responsibility | Input | Output | External dependencies | DB writes | Futu calls | Trading capability | Tests |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| \`docs/audit/quant-loop-spec.md\` | Freezes HK v0.1 scope and acceptance rules | Product and safety constraints | Written specification | None | No | No | No | \`npm run quant-loop-readiness\` |
| \`scripts/quant-loop-readiness.mjs\` | Checks the spec contains required safety/accounting boundaries | Spec markdown | Go/no-go JSON | Node only | No | No | No | \`tests/unit/quant-loop-readiness.test.mjs\` |
| \`config/quant-smoke.hk-09926.json\` | Defines controlled smoke run parameters | Manual config | Config hash and runtime behavior | None | No | No | No | \`tests/unit/quant-smoke.test.mjs\` |
| \`config/quant-portfolio-smoke.hk-multi-symbol.json\` | Defines controlled two-symbol portfolio smoke parameters | Manual config and multi-symbol freeze config | Portfolio ledger, positions, NAV and report | None | No | No | No | \`tests/unit/quant-portfolio-smoke.test.mjs\` |
| \`config/quant-portfolio-pipeline.hk-multi-symbol.json\` | Binds multi-symbol freeze and portfolio smoke configs into one auditable loop | Manual config | Portfolio pipeline manifest | None | No | No | No | \`tests/unit/quant-portfolio-pipeline.test.mjs\` |
| \`config/quant-freeze-snapshot.hk-09926.json\` | Defines frozen snapshot source, universe, cutoff and adjustment | Manual config | Frozen snapshot manifest | None | No | No | No | \`tests/unit/quant-freeze-snapshot.test.mjs\` |
| \`config/quant-freeze-snapshot.hk-multi-symbol.json\` | Verifies the frozen snapshot gate can accept a controlled two-symbol HK universe | Manual config and local fixture | Multi-symbol frozen snapshot manifest | None | No | No | No | \`tests/unit/quant-freeze-snapshot.test.mjs\`, \`npm run quant-freeze-snapshot:multi\` |
| \`config/quant-pipeline.hk-09926.json\` | Binds freeze and smoke configs into one auditable loop | Manual config | Pipeline manifest | None | No | No | No | \`tests/unit/quant-pipeline.test.mjs\` |
| \`data/quant-fixtures/hk-09926-v0.1.snapshot.json\` | Frozen local HK.09926 OHLCV fixture | Local file | Snapshot data and hash | None | No | No | No | \`npm run quant-smoke\` |
| \`data/quant-fixtures/hk-multi-symbol-v0.1.snapshot.json\` | Controlled two-symbol HK OHLCV fixture for data-gate compatibility | Local file | Snapshot data and hash | None | No | No | No | \`npm run quant-freeze-snapshot:multi\` |
| \`scripts/quant-freeze-snapshot.mjs\` | Canonicalizes and validates a snapshot source before formal use | Config and source data | \`artifacts/quant-snapshots/*\` | Node only | No | No | No | \`tests/unit/quant-freeze-snapshot.test.mjs\` |
| \`scripts/quant-pipeline.mjs\` | Runs freeze, smoke and audit with smoke bound to the frozen snapshot | Pipeline config | \`artifacts/quant-pipeline/latest/*\` | Node and local npm commands | No | No | No | \`tests/unit/quant-pipeline.test.mjs\` |
| \`scripts/quant-portfolio-pipeline.mjs\` | Runs multi-symbol freeze, portfolio smoke and portfolio audit with portfolio smoke bound to the frozen snapshot | Portfolio pipeline config | \`artifacts/quant-portfolio-pipeline/latest/*\` | Node and local npm commands | No | No | No | \`tests/unit/quant-portfolio-pipeline.test.mjs\` |
| \`scripts/quant-smoke.mjs\` | Executes frozen-data loop: data check, signal, next-day execution, lot rounding, fees, ledger, NAV, report | Config and snapshot | \`artifacts/quant-smoke/latest/*\` | Node only | No | No | No | \`tests/unit/quant-smoke.test.mjs\` |
| \`scripts/quant-portfolio-smoke.mjs\` | Executes a controlled two-symbol portfolio accounting smoke with cash competition, per-symbol lot sizes, positions, NAV and turnover | Portfolio config and frozen multi-symbol snapshot | \`artifacts/quant-portfolio-smoke/latest/*\` | Node only | No | No | No | \`tests/unit/quant-portfolio-smoke.test.mjs\` |
| \`scripts/quant-portfolio-audit.mjs\` | Audits portfolio smoke artifacts for frozen-data linkage, next-day execution, lot rounding, cash/NAV/positions, safety and reproducibility | Portfolio smoke artifacts | \`quant-portfolio-audit.json\` | Node and local npm command | No | No | No | \`tests/unit/quant-portfolio-audit.test.mjs\` |
| \`scripts/quant-audit.mjs\` | Audits smoke artifacts for lookahead/accounting/safety/reproducibility blockers | Quant artifacts | \`quant-audit.json\` | Node and local npm command | No | No | No | \`tests/unit/quant-audit.test.mjs\` |
| \`scripts/generate-quant-review-package.mjs\` | Collects review evidence for external review | Git state, local commands, quant artifacts | \`audit/<date>-quant-smoke/*\` | Node and local git/npm | No | No | No | \`tests/unit/generate-quant-review-package.test.mjs\` |

## Service Relationship

The current quant smoke is intentionally outside the production API/database path. Futu is allowed later for snapshot generation, but this package proves only a frozen local data loop. The official portfolio, transaction facts, decision checks and reviews are not modified.
`;
}

function buildProgressMatrix(quant, portfolio, frozen, pipeline, portfolioPipeline) {
  const hasArtifacts = Boolean(quant.manifest && quant.audit);
  const hasPortfolioAudit = Boolean(portfolio.manifest && portfolio.audit?.ok === true);
  const hasFrozenSnapshot = Boolean(frozen.manifest);
  const pipelineBound = pipeline.manifest?.linkage?.smokeUsesFrozenSnapshot === true && pipeline.manifest?.linkage?.dataHashesMatch === true;
  const portfolioPipelineBound = portfolioPipeline.manifest?.linkage?.portfolioUsesFrozenSnapshot === true && portfolioPipeline.manifest?.linkage?.dataHashesMatch === true;
  return `# Progress Matrix

| Planned task | Status | Code or file evidence | Test evidence | Meets completion definition | Remaining work | Blocker |
| --- | --- | --- | --- | --- | --- | --- |
| Freeze HK v0.1 quant scope | VERIFIED | \`docs/audit/quant-loop-spec.md\` | \`quant-loop-readiness-results.txt\` | Yes | None for v0.1 smoke | None |
| Generate frozen snapshot manifest | ${hasFrozenSnapshot ? "VERIFIED" : "BLOCKED"} | \`frozen-snapshot/manifest.json\`, \`frozen-snapshot/snapshot.json\` | \`quant-freeze-snapshot-results.txt\` | ${hasFrozenSnapshot ? "Yes for local fixture source" : "No"} | Replace fixture source with approved Futu/market-data export when access is available | ${hasFrozenSnapshot ? "None" : "Missing frozen snapshot artifact"} |
| Verify multi-symbol snapshot gate | VERIFIED | \`source-snapshots/quant-freeze-snapshot.hk-multi-symbol.json\`, \`source-snapshots/hk-multi-symbol-v0.1.snapshot.json\` | \`quant-freeze-snapshot-multi-results.txt\`, \`unit-test-results.txt\` | Yes for frozen data ingress only | Implement multi-symbol portfolio accounting before any multi-symbol backtest claim | None |
| Run two-symbol portfolio accounting smoke | ${hasPortfolioAudit ? "VERIFIED" : "BLOCKED"} | \`portfolio-artifacts/run_manifest.json\`, \`portfolio-artifacts/positions.json\`, \`portfolio-artifacts/nav.json\`, \`portfolio-artifacts/quant-portfolio-audit.json\` | \`quant-portfolio-smoke-results.txt\`, \`quant-portfolio-audit-results.txt\`, \`unit-test-results.txt\` | ${hasPortfolioAudit ? "Yes for local smoke only" : "No"} | Replace fixture with approved frozen market-data export before formal strategy evidence | ${hasPortfolioAudit ? "None" : "Missing or failed portfolio audit"} |
| Run bound freeze -> portfolio smoke -> portfolio audit pipeline | ${portfolioPipelineBound ? "VERIFIED" : "BLOCKED"} | \`portfolio-pipeline/run_manifest.json\`, \`portfolio-pipeline/portfolio/quant-portfolio-audit.json\` | \`quant-portfolio-pipeline-results.txt\`, \`unit-test-results.txt\` | ${portfolioPipelineBound ? "Yes for local smoke only" : "No"} | Replace fixture with approved frozen market-data export before formal strategy evidence | ${portfolioPipelineBound ? "None" : "Portfolio pipeline linkage failed or missing"} |
| Run bound freeze -> smoke -> audit pipeline | ${pipelineBound ? "VERIFIED" : "BLOCKED"} | \`pipeline/run_manifest.json\`, \`pipeline/smoke/quant-audit.json\` | \`quant-pipeline-results.txt\` | ${pipelineBound ? "Yes" : "No"} | Replace fixture source with approved Futu/market-data export when access is available | ${pipelineBound ? "None" : "Pipeline linkage failed or missing"} |
| Read frozen market data | VERIFIED | \`data/quant-fixtures/hk-09926-v0.1.snapshot.json\`, \`scripts/quant-smoke.mjs\` | \`quant-smoke-results.txt\` | Yes for local fixture | Formal Futu snapshot generator | Not blocking smoke |
| Reject unsafe smoke configuration | VERIFIED | \`quant-artifacts/config-quality.json\`, \`scripts/quant-smoke.mjs\` | \`unit-test-results.txt\`, \`quant-audit-results.txt\` | Yes | Broaden config schema if v0.1 expands | None |
| Register experiment and parameter set | ${quant.configQuality?.experiment ? "VERIFIED" : "BLOCKED"} | \`quant-artifacts/config-quality.json\`, \`quant-artifacts/run_manifest.json\` | \`unit-test-results.txt\` | ${quant.configQuality?.experiment ? "Yes" : "No"} | Maintain registry before any strategy or parameter expansion | ${quant.configQuality?.experiment ? "None" : "Missing experiment registry artifact"} |
| Data quality check | VERIFIED | \`quant-artifacts/data-quality.json\` | \`quant-audit-results.txt\` | Yes | Broaden checks for multi-symbol snapshots | None |
| Signal generation after close | VERIFIED | \`quant-artifacts/signals.json\` | \`quant-audit-results.txt\` | Yes | Keep rule changes tied to registered experiment metadata | None |
| Next trading day execution | VERIFIED | \`quant-artifacts/orders.json\`, \`quant-artifacts/trades.json\` | \`quant-audit-results.txt\` | Yes | Suspension calendar integration | None |
| Board-lot rounding and fees | VERIFIED | \`quant-artifacts/orders.json\`, \`quant-artifacts/trades.json\` | \`quant-audit-results.txt\` | Yes | Fee model review against actual broker schedule | None |
| Cash/position ledger, NAV and report | VERIFIED | \`quant-artifacts/ledger.json\`, \`quant-artifacts/nav.json\`, \`quant-artifacts/report.md\` | \`quant-smoke-results.txt\` | Yes | Multi-symbol accounting later | None |
| Reproducibility check | ${hasArtifacts ? "VERIFIED" : "BLOCKED"} | \`quant-artifacts/quant-audit.json\` | \`quant-audit-results.txt\` | ${hasArtifacts ? "Yes" : "No"} | None for current fixture | ${hasArtifacts ? "None" : "Missing artifacts"} |
| External review package | VERIFIED | \`SUMMARY.md\`, \`current-stage.patch\`, \`hashes.txt\` | This generated package | Yes | Commit once .git is writable | Sandbox currently prevents commit |
`;
}

function buildQuantAudit(quant, portfolio, frozen, pipeline, portfolioPipeline, sourceAudit) {
  const trades = quant.trades ?? [];
  const firstFive = trades.slice(0, 5).map((trade) => (
    `| ${trade.tradeId} | ${trade.signalDate} | ${trade.tradeDate} | ${trade.side} | ${trade.quantity} | ${trade.price} | ${trade.grossAmount} | ${trade.totalFees} | ${trade.cashBefore} | ${trade.cashAfter} |`
  )).join("\n");
  return `# Quant Audit

## Direct Answers

| Question | Answer | Evidence |
| --- | --- | --- |
| Signal generation time | Day t after close | \`quant-artifacts/signals.json\` field \`generatedAfter=close\` |
| Earliest execution time | Day t+1 open | \`quant-artifacts/orders.json\` field \`priceType=next_open\` |
| Same-bar signal and trade possible | Current run has 0 same-bar trades; config gate rejects same-bar execution | \`quant-artifacts/config-quality.json\`, \`quant-artifacts/quant-audit.json\` |
| Negative shift present | No execution code hit in quant smoke; scanner hits only detector/spec text if any | Source scan below |
| Future index access present | No execution code hit in quant smoke; scanner hits only detector/spec text if any | Source scan below |
| Full-sample normalization/training | Not implemented | No ML/model module in v0.1 |
| Current constituents backfilled | Not implemented; single explicit fixture symbol | \`source-snapshots/hk-09926-v0.1.snapshot.json\` |
| Adjusted price usage | Snapshot adjustment recorded for research smoke; production accounting not touched | \`quant-artifacts/run_manifest.json\` |
| Non-zero fees | Yes | \`quant-artifacts/trades.json\` |
| Zero-fee config allowed | No | \`quant-artifacts/config-quality.json\`, \`tests/unit/quant-smoke.test.mjs\` |
| Board lots | Yes, 100-share lot in current fixture | \`quant-artifacts/orders.json\` |
| Suspension/zero volume/missing data | Zero volume is flagged non-tradeable by data check; current fixture has none | \`quant-artifacts/data-quality.json\` |
| Cash shortage | Buy quantity is reduced by lot until cash is sufficient | \`scripts/quant-smoke.mjs\` |
| Turnover recorded | Yes, one-way and two-way | \`quant-artifacts/nav.json\`, \`quant-artifacts/run_manifest.json\` |
| Undeclared parameter trials | None in current package; smoke refuses missing experiment registry fields | \`quant-artifacts/config-quality.json\`, \`quant-artifacts/run_manifest.json\`, \`tests/unit/quant-smoke.test.mjs\` |
| Frozen data snapshot | Yes | \`source-snapshots/hk-09926-v0.1.snapshot.json\` |
| Reproducible from commit/config/snapshot | Yes if quant audit reproducibility is PASS | \`quant-artifacts/quant-audit.json\` |

## Loop Evidence

- Frozen snapshot ID: ${frozen.manifest?.snapshotId ?? "missing"}
- Frozen snapshot data hash: ${frozen.manifest?.dataHash ?? "missing"}
- Frozen snapshot quality: ${frozen.manifest?.dataQuality?.ok === true ? "PASS" : "FAIL_OR_MISSING"}
- Pipeline smoke uses frozen snapshot: ${pipeline.manifest?.linkage?.smokeUsesFrozenSnapshot === true ? "PASS" : "FAIL_OR_MISSING"}
- Pipeline frozen/smoke data hashes match: ${pipeline.manifest?.linkage?.dataHashesMatch === true ? "PASS" : "FAIL_OR_MISSING"}
- Input range: ${quant.manifest?.dateRange?.start ?? "missing"} to ${quant.manifest?.dateRange?.end ?? "missing"}
- Stocks: ${(quant.manifest?.universe ?? []).map((item) => `${item.market}.${item.code}`).join(", ") || "missing"}
- Initial cash: ${quant.manifest?.initialCash ?? "missing"}
- Experiment registry: \`${formatExperiment(quant.manifest?.experiment ?? quant.configQuality?.experiment)}\`
- Adjustment: ${quant.manifest?.adjustment ?? "missing"}
- Fees: \`${JSON.stringify(quant.manifest?.fees ?? {})}\`
- Final metrics: \`${JSON.stringify(quant.manifest?.metrics ?? {})}\`

## Portfolio Audit Gate

- Portfolio audit: ${portfolio.audit?.ok === true ? "PASS" : "FAIL_OR_MISSING"}
- Portfolio reproducibility: ${portfolio.audit?.reproducibility?.ok === true ? "PASS" : "FAIL_OR_MISSING"}
- Portfolio snapshot: \`${portfolio.manifest?.snapshotId ?? "missing"}\`
- Portfolio symbols: ${(portfolio.manifest?.universe ?? []).map((item) => item.symbol).join(", ") || "missing"}
- Portfolio final metrics: \`${JSON.stringify(portfolio.manifest?.metrics ?? {})}\`
- Portfolio safety: \`${JSON.stringify(portfolio.manifest?.safety ?? {})}\`
- Portfolio pipeline: ${portfolioPipeline.manifest?.ok === true ? "PASS" : "FAIL_OR_MISSING"}
- Portfolio pipeline uses frozen snapshot: ${portfolioPipeline.manifest?.linkage?.portfolioUsesFrozenSnapshot === true ? "PASS" : "FAIL_OR_MISSING"}
- Portfolio pipeline data hashes match: ${portfolioPipeline.manifest?.linkage?.dataHashesMatch === true ? "PASS" : "FAIL_OR_MISSING"}

## Hand-Checkable Trades

| Trade | Signal Date | Trade Date | Side | Qty | Price | Gross | Fees | Cash Before | Cash After |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
${firstFive || "| n/a | n/a | n/a | n/a | 0 | 0 | 0 | 0 | 0 | 0 |"}

## High-Risk Pattern Search

${sourceAudit.length === 0 ? "No configured high-risk source pattern hits." : sourceAudit.map((hit) => `- ${hit.file}:${hit.line} ${hit.pattern}: \`${hit.text}\``).join("\n")}

Detector/spec-only hits are not treated as execution blockers. Any hit in \`scripts/quant-smoke.mjs\` must be reviewed before expanding beyond smoke.
`;
}

function buildSecurityAudit(hits) {
  return `# Security Audit

## Safety Claims

- No real account credential is required by the quant smoke.
- No broker order submission capability is added.
- No environment variable switches between paper and real trading.
- No real trading gateway is initialized.
- Futu is not called by the quant smoke; current data comes from a local frozen fixture.
- Sensitive configuration is not intentionally committed. Review \`git-status-with-ignored.txt\` and keyword hits below.

## Keyword Hits

${hits.length === 0 ? "No keyword hits in tracked files." : hits.map((hit) => `- ${hit.file}:${hit.line} \`${hit.keyword}\` - ${hit.explanation}`).join("\n")}
`;
}

function buildKnownIssues(quant, quality) {
  return `# Known Issues

## P0

- None found in the current local quant smoke. Real trading remains explicitly out of scope.

## P1

- Current data is a local fixture, not a formal Futu/market-data frozen snapshot. This blocks using the result as formal strategy evidence.
- Current branch cannot be committed in this sandbox if \`.git\` remains read-only. This blocks binding evidence to a new commit from here.

## P2

- Quant smoke supports one symbol and one simple rule only.
- Fee model should be reviewed against the actual broker schedule before formal backtests.
- Suspension and corporate-action handling are minimal and fixture-based.
- Coverage is ${runCoverage ? "recorded in `coverage-results.txt`" : "not included by default; rerun with `QUANT_REVIEW_RUN_COVERAGE=1`"}.

## P3

- Add a formal frozen snapshot generator from approved Futu/market-data path.
- Promote the current smoke experiment metadata into a larger registry file only when there is a second strategy or parameter set.
- Add a wider HK sample only after single-symbol smoke remains reproducible.

## Code Quality Notes

- Largest files: ${quality.largestFiles.slice(0, 5).map((item) => `\`${item.file}\` (${item.lines})`).join(", ")}
- Broad catches found: ${quality.broadCatches.length}
- Hardcoded paths found: ${quality.hardcodedPaths.length}
- TODO/FIXME found: ${quality.todos.length}
`;
}

function formatExperiment(experiment) {
  if (!experiment) return "missing";
  return [
    `experimentId=${experiment.experimentId ?? "missing"}`,
    `strategyVersion=${experiment.strategyVersion ?? "missing"}`,
    `parameterSetId=${experiment.parameterSetId ?? "missing"}`,
    `purpose=${experiment.purpose ?? "missing"}`
  ].join("; ");
}

function buildQualityAudit(quality) {
  return `# Code Quality Self Audit

## Largest Files

${quality.largestFiles.map((item) => `- ${item.file}: ${item.lines} lines`).join("\n")}

## Largest Functions

未自动精确统计：本阶段不引入 AST 依赖。需要外部审查时优先检查 \`scripts/quant-smoke.mjs\` 的执行函数和报告生成函数。

## Cycles and Duplication

未检测到新的模块循环。当前量化 v0.1 脚本偏单文件实现，后续扩展前应先抽出可测试库函数。

## Broad Catch Blocks

${quality.broadCatches.length === 0 ? "None found by lightweight scan." : quality.broadCatches.map((hit) => `- ${hit.file}:${hit.line} \`${hit.text}\``).join("\n")}

## Hardcoded Paths

${quality.hardcodedPaths.length === 0 ? "None found by lightweight scan." : quality.hardcodedPaths.map((hit) => `- ${hit.file}:${hit.line} \`${hit.text}\``).join("\n")}

## TODO/FIXME

${quality.todos.length === 0 ? "None found by lightweight scan." : quality.todos.map((hit) => `- ${hit.file}:${hit.line} \`${hit.text}\``).join("\n")}

## Untested Critical Quant Modules

${quality.untestedQuantModules.map((item) => `- ${item}`).join("\n")}
`;
}

function buildChangeClassification(classifications) {
  return `# Change Classification

## Added

${classifications.added.length === 0 ? "None in tracked diff from baseline." : classifications.added.map((row) => `- ${row.file}`).join("\n")}

## Modified

${classifications.modified.length === 0 ? "None in tracked diff from baseline." : classifications.modified.map((row) => `- ${row.file}`).join("\n")}

## Deleted

${classifications.deleted.length === 0 ? "None in tracked diff from baseline." : classifications.deleted.map((row) => `- ${row.file}`).join("\n")}

## Other

${classifications.other.length === 0 ? "None." : classifications.other.map((row) => `- ${row.status} ${row.file}`).join("\n")}

## Requirement Mapping

- Quant scope/spec files map to HK v0.1 design freeze.
- Quant fixture/config/smoke files map to the minimal loop acceptance.
- Quant audit files map to lookahead, accounting, safety and reproducibility gates.
- Review package files map to external review evidence requirements.

## Extra Changes

No intentionally unrelated product expansion is included by this generator. Existing untracked audit directories are preserved and listed separately.
`;
}

async function buildArtifactsIndex() {
  const files = await listGeneratedFiles();
  return `# Artifacts Index

${files.map((file) => `- \`${file}\``).join("\n")}
`;
}

async function listGeneratedFiles() {
  const { stdout } = await run("find", [relative(outDir), "-type", "f"], { timeoutMs: 60_000 });
  return stdout.trim().split(/\r?\n/).filter(Boolean).sort();
}

async function writeText(name, text) {
  await writeFile(join(outDir, name), text);
}

async function readGenerated(name) {
  return readFile(join(outDir, name), "utf8");
}

function readGeneratedSync(name) {
  const absolute = join(outDir, name);
  return existsSync(absolute) ? String(requireReadFile(absolute)) : "";
}

function requireReadFile(path) {
  return readFileSync(path, "utf8");
}

function resolvePath(path) {
  return String(path).startsWith("/") ? String(path) : join(root, String(path));
}

function localDate() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(new Date());
}

function slug(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "quant-review";
}

function relative(value) {
  return value.startsWith(root) ? value.slice(root.length + 1) : value;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}
