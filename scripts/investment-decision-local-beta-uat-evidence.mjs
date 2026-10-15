#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  cleanGitIntervalEvidence,
  deriveSafetyEvidence,
  validateGitIntervalEvidence,
  validateSafetyEvidenceBinding,
  validateXcresultExecutionEvidence
} from "./ios-gate-b-local-beta-uat-evidence.mjs";
import {
  IOS_GATE_B_UI_TEST_TARGETS,
  IOS_GATE_B_UNIT_TEST_TARGETS
} from "./ios-gate-b-test-matrix.mjs";
import {
  REQUIRED_WEB_SCREENSHOTS,
  pngViewportFromBytes,
  validRouteSet,
  validateExactHead,
  validateScreenshotMatch,
  validateScreenshots,
  validateWebEvidence,
  validateWebViewportCoverage
} from "./ios-gate-b-local-beta-uat-web-evidence.mjs";
const root = process.cwd();
const artifactRoot = path.join(root, "artifacts", "local-beta-uat");
const webEvidencePath = path.join(artifactRoot, "web", "request-ledger.json");
const iosEvidencePath = path.join(root, "artifacts", "ios-gate-b-ui-smoke", "summary.json");
const iosScreenshotDir = path.join(root, "artifacts", "ios-gate-b-ui-smoke", "screenshots");
const manifestPath = path.join(artifactRoot, "manifest.json");

export { REQUIRED_WEB_SCREENSHOTS, pngViewportFromBytes };
export const REQUIRED_IOS_SCREENSHOTS = [
  "annual-decision-rings.png",
  "current-portfolio-neutral-risk.png",
  "pingan-snapshot-unavailable.png",
  "quant-decision-evidence.png",
  "selected-symbol-decision-screen.png",
  "submitted-check-result.png",
  "daily-workbench-compact-320.png",
  "daily-workbench-standard-390.png",
  "daily-workbench-large-430.png",
  "daily-workbench-accessibility-320.png",
  "daily-workbench-accessibility-390.png",
  "daily-workbench-accessibility-430.png",
  "annual-rings-eight-question-golden.png"
];
export const REQUIRED_IOS_TESTS = IOS_GATE_B_UI_TEST_TARGETS.map((target) => target.split("/").at(-1));
export const REQUIRED_IOS_UNIT_TESTS = [...IOS_GATE_B_UNIT_TEST_TARGETS];

export function validateLocalBetaUatEvidence({
  head,
  status,
  expectedSimulatorUdid,
  webEvidence,
  iosEvidence,
  webScreenshots,
  iosScreenshots
}) {
  const errors = [];
  if (!/^[0-9a-f]{40}$/.test(head)) errors.push("head must be a full Git SHA");
  if (status.trim() !== "") errors.push("worktree must be clean for exact-head UAT evidence");
  if (!expectedSimulatorUdid) errors.push("expected project iPhone Simulator UDID is required");

  validateWebEvidence(webEvidence, head, errors);
  validateIosEvidence(iosEvidence, head, expectedSimulatorUdid, errors);
  validateScreenshots(webScreenshots, REQUIRED_WEB_SCREENSHOTS, "Web", errors, { requireViewport: true });
  validateScreenshots(iosScreenshots, REQUIRED_IOS_SCREENSHOTS, "iOS", errors);
  validateWebViewportCoverage(webScreenshots, "Web", errors);
  validateScreenshotMatch(
    webEvidence?.screenshots,
    webScreenshots,
    REQUIRED_WEB_SCREENSHOTS,
    "Web",
    errors,
    { requireViewport: true }
  );
  validateScreenshotMatch(iosEvidence?.screenshots, iosScreenshots, REQUIRED_IOS_SCREENSHOTS, "iOS", errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateIosEvidence(value, head, expectedSimulatorUdid, errors) {
  if (value?.ok !== true || value?.mode !== "full" || value?.requestedUITest !== null) {
    errors.push("iOS full UAT summary is missing or invalid");
    return;
  }
  validateExactHead(value, head, "iOS", errors);
  validateGitIntervalEvidence(value.gitInterval, head, "iOS", errors);
  if (value.simulator?.udid !== expectedSimulatorUdid) errors.push("iOS UAT used the wrong Simulator UDID");
  if (value.simulator?.deviceFamily !== "iPhone") errors.push("iOS UAT target must be an iPhone Simulator");
  if (value.simulator?.shutdownVerified !== true) errors.push("iOS UAT Simulator shutdown is not verified");
  for (const field of ["initialFreeGiB", "completedFreeGiB", "postCleanupFreeGiB"]) {
    if (!Number.isFinite(value.disk?.[field]) || value.disk[field] < 12) errors.push(`iOS ${field} must be at least 12 GiB`);
  }
  for (const field of ["derivedDataRemoved", "resultBundlesRemoved", "attachmentExportsRemoved"]) {
    if (value.cleanup?.[field] !== true) errors.push(`iOS cleanup ${field} is required`);
  }
  validateXcresultExecutionEvidence(
    value.tests,
    REQUIRED_IOS_UNIT_TESTS,
    IOS_GATE_B_UI_TEST_TARGETS,
    "iOS UAT",
    errors
  );
  validRouteSet(value.requestLedger, "iOS", errors);
  validateSafetyEvidenceBinding(value.safety, value.requestLedger, "iOS", errors);
}

async function main() {
  await rm(manifestPath, { force: true });
  if (Number(process.versions.node.split(".")[0]) !== 24) {
    throw new Error(`Local Beta UAT evidence requires Node 24, received ${process.version}`);
  }
  const expectedSimulatorUdid = String(process.env.LOCAL_BETA_UAT_SIMULATOR_UDID ?? "").trim();
  if (!expectedSimulatorUdid) throw new Error("LOCAL_BETA_UAT_SIMULATOR_UDID is required");
  const gitStart = readGitState();
  cleanGitIntervalEvidence(gitStart, gitStart, "Local Beta UAT preflight");
  const { head, status } = gitStart;
  const focusedWebValidation = runFocusedWebValidation();
  const [webEvidence, iosEvidence, webScreenshots, iosScreenshots] = await Promise.all([
    readJson(webEvidencePath),
    readJson(iosEvidencePath),
    screenshotEvidence(path.join(artifactRoot, "web"), REQUIRED_WEB_SCREENSHOTS),
    screenshotEvidence(iosScreenshotDir, REQUIRED_IOS_SCREENSHOTS)
  ]);
  const validation = validateLocalBetaUatEvidence({
    head,
    status,
    expectedSimulatorUdid,
    webEvidence,
    iosEvidence,
    webScreenshots,
    iosScreenshots
  });
  if (!validation.ok) throw new Error(validation.errors.join("; "));
  const gitInterval = cleanGitIntervalEvidence(gitStart, readGitState(), "Local Beta UAT");
  const ledgerSafety = deriveSafetyEvidence([...webEvidence.requestLedger, ...iosEvidence.requestLedger]);

  const manifest = {
    schemaVersion: "2026-07-18.investment-decision-local-beta-uat.v2",
    ok: true,
    head,
    generatedAt: new Date().toISOString(),
    exactHeadClean: gitInterval.startClean && gitInterval.endClean && gitInterval.stable,
    gitInterval,
    focusedWebValidation,
    web: {
      evidencePath: path.relative(root, webEvidencePath),
      evidenceSha256: await fileSha256(webEvidencePath),
      requestLedger: webEvidence.requestLedger,
      screenshots: webScreenshots
    },
    ios: {
      evidencePath: path.relative(root, iosEvidencePath),
      evidenceSha256: await fileSha256(iosEvidencePath),
      simulator: iosEvidence.simulator,
      disk: iosEvidence.disk,
      tests: iosEvidence.tests,
      requestLedger: iosEvidence.requestLedger,
      screenshots: iosScreenshots,
      cleanup: iosEvidence.cleanup
    },
    safety: {
      advisoryOnly: true,
      deterministicFixturesOnly: true,
      production: ledgerSafety.production,
      brokerCalls: ledgerSafety.brokerCalls,
      orderTradeFillRequests: ledgerSafety.tradingSideEffectRequests,
      cashFeePositionMutations: ledgerSafety.cashFeePositionMutations,
      officialPortfolioMutations: ledgerSafety.officialPortfolioMutations,
      productionWrites: ledgerSafety.productionWrites,
      requestLedgerSha256: ledgerSafety.requestLedgerSha256
    }
  };
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  try {
    cleanGitIntervalEvidence(gitStart, readGitState(), "Local Beta UAT manifest");
  } catch (error) {
    await rm(manifestPath, { force: true });
    throw error;
  }
  console.log(JSON.stringify({
    ok: true,
    head,
    manifestPath: path.relative(root, manifestPath),
    webScreenshots: webScreenshots.length,
    iosScreenshots: iosEvidence.screenshots.length,
    simulatorShutdownVerified: true,
    temporaryBuildArtifactsRemoved: true,
    tradingSideEffectRequests: manifest.safety.orderTradeFillRequests,
    production: manifest.safety.production
  }, null, 2));
}

function runFocusedWebValidation() {
  const startedAt = Date.now();
  execFileSync(process.execPath, [
    "--test",
    "tests/unit/web-api-client-state.test.mjs",
    "tests/unit/web-assist-source-cascade-clearing-state.test.mjs",
    "tests/unit/web-authorization-invalidation.test.mjs",
    "tests/unit/web-decision-workspace-realignment.test.mjs",
    "tests/unit/web-portfolio-workspace-controller.test.mjs",
    "tests/unit/web-post-decision-portfolio-review-submission.test.mjs"
  ], { cwd: root, stdio: "pipe" });
  const smokeOutput = execFileSync(process.execPath, ["scripts/web-core-journey-ui-smoke.mjs"], {
    cwd: root,
    encoding: "utf8"
  });
  const smoke = JSON.parse(smokeOutput);
  if (smoke.ok !== true || smoke.tradingSideEffectRequests !== 0) {
    throw new Error("Web semantic smoke did not preserve zero-side-effect success");
  }
  return {
    ok: true,
    durationMs: Date.now() - startedAt,
    unitFiles: 6,
    semanticSmoke: smoke.smoke,
    semanticProxiedRequests: smoke.proxiedRequests,
    states: ["available", "stale", "partial", "zero_position", "conflict", "unauthorized", "offline", "malformed", "blocked", "superseded"],
    tradingSideEffectRequests: 0
  };
}

async function screenshotEvidence(directory, names) {
  return Promise.all(names.map(async (name) => {
    const file = path.join(directory, name);
    const bytes = await readFile(file);
    const evidence = { name, bytes: bytes.length, sha256: sha256(bytes) };
    return directory === iosScreenshotDir
      ? evidence
      : { ...evidence, viewport: pngViewportFromBytes(bytes) };
  }));
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function fileSha256(file) {
  return sha256(await readFile(file));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}
function readGitState() {
  const status = git("status", "--porcelain", "--untracked-files=all");
  return { head: git("rev-parse", "HEAD"), status, worktreeSha256: sha256(status ? `dirty:${status}` : "") };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
