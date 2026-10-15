import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const args = new Set(process.argv.slice(2));
const appRoot = path.join(root, "apps/ios/AnnualRingsGateA");
const workDir = path.join(root, "artifacts", "ios-staging-smoke");
const derivedDataPath = path.join(workDir, "DerivedData");
const marketScreenshotPath = path.join(workDir, "staging-market.png");
const researchScreenshotPath = path.join(workDir, "staging-research.png");
const baseUrl = process.env.STAGING_BASE_URL ?? "http://127.0.0.1:4511";
const symbol = process.env.STAGING_SYMBOL ?? "HK.09926";
const authToken = process.env.STAGING_READONLY_AUTH_TOKEN ?? "";
const authHeaderName = process.env.STAGING_READONLY_AUTH_HEADER_NAME ?? "";
const writeTokens = [process.env.WRITE_API_TOKEN ?? "", process.env.INTERNAL_API_TOKEN ?? ""].filter(Boolean);
const expectedReadOnly = process.env.STAGING_READONLY_MODE === "1";
const expectedReadOnlyIdentity = process.env.STAGING_READONLY_IDENTITY ?? "";
const authorization = process.env.STAGING_READONLY_AUTHORIZATION ?? "";
const expectedAuthorization = "授权执行 staging read-only validation";
const approvedBaseUrl = process.env.STAGING_READONLY_APPROVED_BASE_URL ?? "";
const productionBaseUrl = process.env.STAGING_READONLY_PRODUCTION_BASE_URL ?? process.env.CANDIDATE_PRODUCTION_BASE_URL ?? "";
const bundleId = "com.example.AnnualRingsGateA";
const stagedGetPaths = [
  "/health",
  `/api/mobile/market/quotes/${symbol.replace(".", "/")}`,
  `/api/mobile/research/profiles/${symbol.replace(".", "/")}`,
  `/api/mobile/research/decision-context/${symbol.replace(".", "/")}`,
  `/api/mobile/research/portfolio/pingan-snapshot/${symbol.replace(".", "/")}`,
  `/api/mobile/research/profiles/${symbol.replace(".", "/")}/decision-reviews`
];

if (args.has("--dry-run-url-plan")) {
  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    symbol,
    requests: stagedGetPaths.map((requestPath) => ({
      method: "GET",
      path: requestPath,
      url: buildCandidateUrl(requestPath).toString(),
      includesReadOnlyAuth: isProtectedGetPath(requestPath)
    }))
  }, null, 2));
  process.exit(0);
}

assertApprovedLiveTarget();

await rm(workDir, { recursive: true, force: true });
await mkdir(workDir, { recursive: true });

const health = await fetchJson(stagedGetPaths[0]);
if (!health.ok || health.marketProvider !== "futu") {
  throw new Error(`staging health check did not report futu provider: ${JSON.stringify(health)}`);
}
if (expectedReadOnly && health.staging?.readOnly !== true) {
  throw new Error(`staging health check did not report read-only mode: ${JSON.stringify(health)}`);
}
if (expectedReadOnly && (!expectedReadOnlyIdentity || health.staging?.identity !== expectedReadOnlyIdentity)) {
  throw new Error("staging health check did not report the expected read-only identity");
}

const quote = await fetchJson(stagedGetPaths[1]);
if (quote.status !== "live" || quote.source?.provider !== "futu") {
  throw new Error(`staging quote is not live Futu data: ${JSON.stringify(quote)}`);
}

const research = await fetchJson(stagedGetPaths[2]);
if (!research.data?.profile || !Array.isArray(research.data.evidence)) {
  throw new Error(`staging research profile is not available: ${JSON.stringify(research)}`);
}
const decisionContext = await fetchJson(stagedGetPaths[3]);
if (!decisionContext.contextId || decisionContext.requestedSymbol !== symbol) {
  throw new Error(`staging decision context is not available: ${JSON.stringify(decisionContext)}`);
}
const pinganSnapshot = await fetchJson(stagedGetPaths[4], true);
if (!pinganSnapshot.schemaVersion || pinganSnapshot.requestedSymbol !== symbol) {
  throw new Error(`staging Pingan snapshot is not available: ${JSON.stringify(pinganSnapshot)}`);
}
const decisionReviews = await fetchJson(stagedGetPaths[5], true);
if (!Array.isArray(decisionReviews.checks)) {
  throw new Error(`staging decision-review history is not available: ${JSON.stringify(decisionReviews)}`);
}

await run("xcodegen", ["generate", "--quiet"], { cwd: appRoot });
await run("xcodebuild", [
  "-project", "AnnualRingsGateAApp.xcodeproj",
  "-scheme", "AnnualRingsGateAApp",
  "-destination", "generic/platform=iOS Simulator",
  "-derivedDataPath", derivedDataPath,
  "build",
  "CODE_SIGNING_ALLOWED=NO",
  "-quiet"
], { cwd: appRoot });

const appPath = path.join(derivedDataPath, "Build/Products/Debug-iphonesimulator/AnnualRingsGateAApp.app");
const udid = await pickSimulator();
await bootSimulator(udid);
await run("xcrun", ["simctl", "install", udid, appPath]);
await captureState(udid, "market", marketScreenshotPath);
await captureState(udid, "research", researchScreenshotPath);

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  symbol,
  readOnly: health.staging?.readOnly === true,
  stagingIdentity: health.staging?.identity ?? null,
  marketStatus: quote.status,
  marketProvider: quote.source.provider,
  researchEvidenceCount: research.data.evidence.length,
  decisionContextId: decisionContext.contextId,
  pinganSnapshotSchemaVersion: pinganSnapshot.schemaVersion,
  decisionReviewCheckCount: decisionReviews.checks.length,
  screenshots: [marketScreenshotPath, researchScreenshotPath]
}, null, 2));

async function fetchJson(requestPath, includeAuth = false) {
  const headers = { accept: "application/json" };
  if (includeAuth) {
    if (!authToken || !authHeaderName) {
      throw new Error("read-only staging auth header and token are required for protected GET validation");
    }
    headers[authHeaderName] = authToken;
  }
  const response = await fetch(buildCandidateUrl(requestPath), {
    headers
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${requestPath} returned ${response.status}: ${text}`);
  }
  return JSON.parse(text);
}

function buildCandidateUrl(requestPath) {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(requestPath.replace(/^\/+/, ""), normalizedBase);
}

function assertApprovedLiveTarget() {
  if (!expectedReadOnly) {
    throw new Error("STAGING_READONLY_MODE=1 is required before live iOS validation");
  }
  if (!expectedReadOnlyIdentity || isPlaceholder(expectedReadOnlyIdentity)) {
    throw new Error("STAGING_READONLY_IDENTITY must be a non-placeholder value before live iOS validation");
  }
  if (authorization !== expectedAuthorization) {
    throw new Error("STAGING_READONLY_AUTHORIZATION must explicitly authorize live iOS validation");
  }
  if (!authHeaderName || !authToken) {
    throw new Error("read-only staging auth header and token are required before live iOS validation");
  }
  if (isPlaceholder(authHeaderName)) {
    throw new Error("STAGING_READONLY_AUTH_HEADER_NAME must be non-placeholder before live iOS validation");
  }
  if (isPlaceholder(authToken) || isForbiddenReadOnlyTokenSentinel(authToken)) {
    throw new Error("STAGING_READONLY_AUTH_TOKEN must be non-placeholder and not the documented sentinel before live iOS validation");
  }
  if (writeTokens.includes(authToken)) {
    throw new Error("STAGING_READONLY_AUTH_TOKEN must be distinct from WRITE_API_TOKEN and INTERNAL_API_TOKEN before live iOS validation");
  }
  if (!isCandidateUrl(baseUrl)) {
    throw new Error("STAGING_BASE_URL must be an HTTP(S) staging candidate /candidate-api URL before live iOS validation");
  }
  if (!urlsExactlyMatch(baseUrl, approvedBaseUrl)) {
    throw new Error("STAGING_READONLY_APPROVED_BASE_URL must exactly match STAGING_BASE_URL before live iOS validation");
  }
  if (urlsExactlyMatch(baseUrl, productionBaseUrl)) {
    throw new Error("STAGING_BASE_URL must not match the supplied production URL before live iOS validation");
  }
}

function isCandidateUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:")
      && url.pathname.includes("/candidate-api")
      && !url.pathname.endsWith("/api")
      && !url.pathname.includes("/api/");
  } catch {
    return false;
  }
}

function urlsExactlyMatch(left, right) {
  if (!left || !right || !isCandidateUrl(left) || !isCandidateUrl(right)) return false;
  return normalizeUrl(left) === normalizeUrl(right);
}

function normalizeUrl(value) {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function isProtectedGetPath(requestPath) {
  return requestPath.includes("/portfolio/pingan-snapshot/")
    || requestPath.endsWith("/decision-reviews");
}

function isPlaceholder(value) {
  return /^(test|synthetic|placeholder|changeme|redacted|example|dummy|local)([-_a-z0-9]*)?$/i.test(value)
    || value.includes("<")
    || value.includes(">");
}

function isForbiddenReadOnlyTokenSentinel(value) {
  return value.trim().toLowerCase() === "replace-in-secret-manager-with-readonly-scoped-token";
}

async function captureState(udid, tab, outputPath) {
  await run("xcrun", ["simctl", "launch", "--terminate-running-process", udid, bundleId], {
    SIMCTL_CHILD_ANNUAL_RINGS_GATE_A_BASE_URL: baseUrl,
    SIMCTL_CHILD_ANNUAL_RINGS_GATE_A_SYMBOL: symbol,
    SIMCTL_CHILD_ANNUAL_RINGS_INITIAL_TAB: tab,
    SIMCTL_CHILD_ANNUAL_RINGS_AUTH_TOKEN: authToken,
    SIMCTL_CHILD_ANNUAL_RINGS_AUTH_HEADER: authHeaderName
  });
  await sleep(tab === "research" ? 3_000 : 2_500);
  await run("xcrun", ["simctl", "io", udid, "screenshot", outputPath]);
  const screenshot = await stat(outputPath);
  if (screenshot.size < 10_000) {
    throw new Error(`${tab} screenshot is unexpectedly small: ${screenshot.size} bytes`);
  }
}

async function pickSimulator() {
  const result = await run("xcrun", ["simctl", "list", "devices", "available", "-j"], { silent: true });
  const payload = JSON.parse(result.stdout);
  const devices = Object.values(payload.devices).flat();
  const preferred = devices.find((device) => device.name === "iPhone 17 Pro")
    ?? devices.find((device) => String(device.name).startsWith("iPhone"))
    ?? devices[0];
  if (!preferred) {
    throw new Error("no available iOS simulator found");
  }
  console.log(`using simulator ${preferred.name} (${preferred.udid})`);
  return preferred.udid;
}

async function bootSimulator(udid) {
  try {
    await run("xcrun", ["simctl", "boot", udid]);
  } catch (error) {
    const stderr = typeof error.stderr === "string" ? error.stderr : "";
    if (!stderr.includes("Unable to boot device in current state: Booted")) {
      throw error;
    }
  }
  await run("xcrun", ["simctl", "bootstatus", udid, "-b"]);
}

async function run(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    cwd: options.cwd ?? root,
    env: {
      ...process.env,
      ...(options.SIMCTL_CHILD_ANNUAL_RINGS_GATE_A_BASE_URL ? {
        SIMCTL_CHILD_ANNUAL_RINGS_GATE_A_BASE_URL: options.SIMCTL_CHILD_ANNUAL_RINGS_GATE_A_BASE_URL
      } : {}),
      ...(options.SIMCTL_CHILD_ANNUAL_RINGS_GATE_A_SYMBOL ? {
        SIMCTL_CHILD_ANNUAL_RINGS_GATE_A_SYMBOL: options.SIMCTL_CHILD_ANNUAL_RINGS_GATE_A_SYMBOL
      } : {}),
      ...(options.SIMCTL_CHILD_ANNUAL_RINGS_INITIAL_TAB ? {
        SIMCTL_CHILD_ANNUAL_RINGS_INITIAL_TAB: options.SIMCTL_CHILD_ANNUAL_RINGS_INITIAL_TAB
      } : {}),
      ...(options.SIMCTL_CHILD_ANNUAL_RINGS_AUTH_TOKEN ? {
        SIMCTL_CHILD_ANNUAL_RINGS_AUTH_TOKEN: options.SIMCTL_CHILD_ANNUAL_RINGS_AUTH_TOKEN
      } : {}),
      ...(options.SIMCTL_CHILD_ANNUAL_RINGS_AUTH_HEADER ? {
        SIMCTL_CHILD_ANNUAL_RINGS_AUTH_HEADER: options.SIMCTL_CHILD_ANNUAL_RINGS_AUTH_HEADER
      } : {})
    },
    maxBuffer: 30 * 1024 * 1024
  });
  if (!options.silent) {
    if (result.stdout.trim()) console.log(result.stdout.trim());
    if (result.stderr.trim()) console.error(result.stderr.trim());
  }
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
