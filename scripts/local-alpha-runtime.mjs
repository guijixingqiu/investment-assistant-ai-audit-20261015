#!/usr/bin/env node
import { createHash, createHmac, randomBytes } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { bindApiQuantEvidenceEnvironment } from "./lib/local-alpha-quant-catalog.mjs";
import { verifyExistingSchema } from "./local-alpha-schema-preflight.mjs";

const root = process.cwd();
const actorId = process.env.LOCAL_ALPHA_ACTOR_ID ?? "owner-local";
const accountScope = process.env.LOCAL_ALPHA_PINGAN_ACCOUNT_SCOPE ?? "owner-main";
const databaseUrl = process.env.LOCAL_ALPHA_DATABASE_URL;
const rawStoreRoot = process.env.LOCAL_ALPHA_RAW_STORE_ROOT ?? process.env.RESEARCH_DOCUMENT_RAW_STORE_ROOT;
const siblingFutuPython = rawStoreRoot ? path.join(path.dirname(rawStoreRoot), "futu-venv/bin/python") : null;
const python = process.env.LOCAL_ALPHA_FUTU_PYTHON
  ?? (siblingFutuPython && existsSync(siblingFutuPython) ? siblingFutuPython : "python3");
const openDPort = integer(process.env.LOCAL_ALPHA_OPEND_PORT, 11113);
const bridgePort = integer(process.env.LOCAL_ALPHA_BRIDGE_PORT, 4318);
const apiPort = integer(process.env.LOCAL_ALPHA_API_PORT, 4024);
const openDSshTarget = process.env.LOCAL_ALPHA_OPEND_SSH_TARGET?.trim() || null;
const openDSshRemoteHost = process.env.LOCAL_ALPHA_OPEND_SSH_REMOTE_HOST?.trim() || null;
const openDSshRemotePort = integer(process.env.LOCAL_ALPHA_OPEND_SSH_REMOTE_PORT, 11111);
const simulator = process.env.LOCAL_ALPHA_SIMULATOR_UDID;
const device = process.env.LOCAL_ALPHA_DEVICE_UDID?.trim() || null;
const deviceHost = process.env.LOCAL_ALPHA_DEVICE_HOST?.trim() || null;
const dailyIngestTokenFile = process.env.LOCAL_ALPHA_DAILY_INGEST_TOKEN_FILE?.trim() || null;
const experienceLabel = normalizeExperienceLabel(process.env.LOCAL_ALPHA_EXPERIENCE_LABEL);
const experienceTokenFile = process.env.LOCAL_ALPHA_EXPERIENCE_TOKEN_FILE?.trim() || null;
const developmentTeam = process.env.IOS_DEVELOPMENT_TEAM?.trim() || null;
const symbol = process.env.LOCAL_ALPHA_SYMBOL ?? "HK.00175";
const bundleId = "com.example.AnnualRingsGateA";
// The labelled experience session is a separate installed app, so iOS itself keeps its store,
// keychain and local drafts apart from the ordinary daily-use install.
const experienceBundleId = "com.example.AnnualRingsExperience";
const experienceDisplayName = "年轮体验";
const appRoot = path.join(root, "apps/ios/AnnualRingsGateA");
const derivedDataPath = path.join(root, "artifacts/local-alpha-runtime/DerivedData");
const ocrHelperSource = path.join(root, "scripts/research-document-ocr.swift");
const ocrHelperPath = path.join(root, "artifacts/local-alpha-runtime/research-document-ocr");
const ocrModuleCache = path.join(root, "artifacts/local-alpha-runtime/swift-module-cache");
let ocrExecutable = ocrHelperPath;
const aiApiKey = process.env.RESEARCH_AI_API_KEY
  ?? keychainPassword("investment-assistant-system-ai-provider");
const aiEnabled = process.env.LOCAL_ALPHA_ENABLE_AI === "1"
  || (process.env.LOCAL_ALPHA_ENABLE_AI !== "0" && Boolean(aiApiKey));
const serverEntry = path.join(root, "dist/apps/api/src/server.js");
const bridgeEntry = path.join(root, "scripts/futu-quote-bridge.py");
const quantTargets = {
  "HK.00175": { build: "quant-hk00175-dividend-payment-v2", manifest: "artifacts/hk00175-quant-dividend-payment-v2/run_manifest.json" },
  "HK.00700": { build: "quant-hk00700-dividend-payment-v2", manifest: "artifacts/hk00700-quant-dividend-payment-v2/run_manifest.json" }
};
const quantTarget = quantTargets[symbol];
const portfolioQuantManifestPath = process.env.LOCAL_ALPHA_PORTFOLIO_QUANT_MANIFEST
  ?? "artifacts/hk-connect-quant-portfolio-v2/latest/run_manifest.json";
const registeredQuantRunCatalogPath = "artifacts/quant-registered-runs/decision-evidence-catalog.json";
const localTokenTtlSeconds = 30 * 24 * 60 * 60;
const historyUseAuthority = process.env.LOCAL_ALPHA_FUTU_HISTORY_USE_AUTHORITY
  ?? process.env.FUTU_HISTORY_USE_AUTHORITY
  ?? "unknown";
const services = [];
let stopping = false;
let anomalyMonitorTimer = null;
let anomalyMonitorRunning = false;
let sourceMonitorRunning = false;
let sourceMonitorLastCycleAt = 0;
const sourceMonitorAbort = new AbortController();
const sourceMonitorCycleMs = 60 * 60 * 1000;
const anomalyMonitorMinutes = integer(process.env.LOCAL_ALPHA_ANOMALY_CADENCE_MINUTES, 10);
if (anomalyMonitorMinutes < 5 || anomalyMonitorMinutes > 60) fail("anomaly monitor cadence must be 5-60 minutes");
const apiHost = deviceHost ?? "127.0.0.1";
const apiBaseURL = `http://${apiHost}:${apiPort}`;

if (!isLocalPostgresUrl(databaseUrl)) fail("LOCAL_ALPHA_DATABASE_URL must be an explicit loopback or local-socket PostgreSQL database");
if (process.env.LOCAL_ALPHA_EXISTING_SCHEMA_ONLY === "1") {
  try {
    const schema = verifyExistingSchema({ repositoryRoot: root, databaseUrl,
      expectedDatabaseName: process.env.LOCAL_ALPHA_EXPECTED_DATABASE_NAME });
    console.log(`Existing schema verified read-only: ${schema.migrationCount} migrations through ${schema.latestMigration}; migration was not invoked.`);
  } catch (error) {
    fail(`Existing-schema-only preflight failed: ${error instanceof Error ? error.message : "schema unavailable"}`);
  }
}
if (!["confirmed", "unknown", "denied"].includes(historyUseAuthority)) fail("Futu history use authority must be confirmed, unknown, or denied");
if (!rawStoreRoot || !existsSync(rawStoreRoot) || !statSync(rawStoreRoot).isDirectory()) {
  fail("LOCAL_ALPHA_RAW_STORE_ROOT must name the existing repository-external raw store");
}
requireExternalRawStore(rawStoreRoot, root);
probeRawStore(rawStoreRoot);
if (!existsSync(bridgeEntry)) fail("Futu bridge script is missing");
const futuPythonReadyAtStartup = spawnSync(python, ["-c", "import futu"], { stdio: "ignore" }).status === 0;
if (!futuPythonReadyAtStartup) {
  console.warn("futu-api is not available in the selected Python; starting with saved research data and degraded market status.");
}
if (aiEnabled && !aiApiKey) fail("LOCAL_ALPHA_ENABLE_AI=1 requires the current DeepSeek key in Keychain or RESEARCH_AI_API_KEY");
if (!/^[A-Za-z0-9._:/-]{1,200}$/.test(actorId) || !/^[A-Za-z0-9._:/-]{1,200}$/.test(accountScope)) {
  fail("local actor and Pingan account scope contain unsupported characters");
}
if (Boolean(openDSshTarget) !== Boolean(openDSshRemoteHost)
    || (!openDSshTarget && process.env.LOCAL_ALPHA_OPEND_SSH_REMOTE_PORT)) {
  fail("OpenD SSH tunnel target and remote host must be configured together");
}
if (openDSshTarget && (!/^[A-Za-z0-9._-]{1,64}@[A-Za-z0-9.-]{1,253}$/.test(openDSshTarget)
    || !/^[A-Za-z0-9.-]{1,253}$/.test(openDSshRemoteHost)
    || openDSshRemoteHost.includes(".."))) {
  fail("OpenD SSH tunnel target or remote host is invalid");
}
if (Boolean(device) !== Boolean(deviceHost) || device && simulator) {
  fail("LOCAL_ALPHA_DEVICE_UDID and LOCAL_ALPHA_DEVICE_HOST must be configured together and cannot be combined with a Simulator");
}
if (experienceTokenFile && !experienceLabel) {
  fail("LOCAL_ALPHA_EXPERIENCE_TOKEN_FILE requires LOCAL_ALPHA_EXPERIENCE_LABEL");
}
if (experienceLabel && device) {
  fail("LOCAL_ALPHA_EXPERIENCE_LABEL is Simulator-only and cannot be combined with LOCAL_ALPHA_DEVICE_UDID");
}
if (experienceLabel && !/^ias_experience_/.test(new URL(databaseUrl).pathname.replace(/^\//, ""))) {
  fail("LOCAL_ALPHA_EXPERIENCE_LABEL requires LOCAL_ALPHA_DATABASE_URL to name an isolated ias_experience_ database");
}
if (device && (!/^[A-Fa-f0-9-]{8,64}$/.test(device) || !/^[A-Za-z0-9]{10}$/.test(developmentTeam ?? ""))) {
  fail("local device mode requires a valid device UDID and IOS_DEVELOPMENT_TEAM");
}
if (deviceHost && !isAssignedPrivateIpv4(deviceHost)) {
  fail("LOCAL_ALPHA_DEVICE_HOST must be an RFC1918 IPv4 address currently assigned to this Mac");
}
const openDReadyAtStartup = await portIsOpen(openDPort);
if (!openDReadyAtStartup && !openDSshTarget) {
  console.warn(`OpenD on 127.0.0.1:${openDPort} is not reachable; starting with saved research data and degraded market status.`);
}
if (experienceLabel) {
  // The launcher does not choose the store; the operator does, so the isolated database name is
  // required above and the raw store is only announced.
  console.warn(`Experience session "${experienceLabel}" is active: launching ${experienceBundleId} (${experienceDisplayName}) against the isolated ias_experience_ database. Verify LOCAL_ALPHA_RAW_STORE_ROOT is the copied experience raw store before any write.`);
}
if (process.argv.includes("--check")) {
  console.log(JSON.stringify({ ok: true, actorId, accountScope, symbol, openDPort, openD: openDReadyAtStartup ? "reachable" : "unavailable", openDSshTunnel: openDSshTarget ? "configured_not_started" : "disabled", futuPython: futuPythonReadyAtStartup ? "ready" : "unavailable", bridgePort, apiPort, apiHost, simulator: simulator ?? null, device: device ? "configured_not_connected" : null, historyUseAuthority, ai: aiEnabled ? "enabled" : "disabled", experienceLabel, experienceTokenFile: experienceTokenFile ? "configured" : null }));
  process.exit(0);
}
await requirePort("Futu bridge", bridgePort, false);
await requirePort("API", apiPort, false, apiHost);
if (openDSshTarget && openDReadyAtStartup) {
  fail(`OpenD port 127.0.0.1:${openDPort} must be free when this runtime manages the SSH tunnel`);
}
const rebuildQuant = process.argv.includes("--build-quant");
if (rebuildQuant && quantTarget && !run("npm", ["run", quantTarget.build])) fail(`${symbol} quant evidence build failed`);
if (rebuildQuant && quantTarget && !run("npm", ["run", "quant-freeze-snapshot-verify:hk-connect-v2"])) {
  fail("Hong Kong Connect portfolio snapshot verification failed");
}
if (rebuildQuant && quantTarget && !run("npm", ["run", "quant-portfolio-lab-evidence"], {
  QUANT_PORTFOLIO_LAB_CONFIG: "config/quant-portfolio-lab.futu-hk-00175-00700-20260814-u20260922-v2.json"
})) fail("Hong Kong Connect portfolio quant evidence build failed");
const quantManifestSha256 = quantTarget && existsSync(path.join(root, quantTarget.manifest))
  ? createHash("sha256").update(readFileSync(path.join(root, quantTarget.manifest))).digest("hex")
  : null;
const portfolioQuantManifestSha256 = quantTarget && existsSync(path.join(root, portfolioQuantManifestPath))
  ? createHash("sha256").update(readFileSync(path.join(root, portfolioQuantManifestPath))).digest("hex")
  : null;
// Restart recovery: a previously published registered-run catalog artifact is
// re-verified by its own digest and used as the accepted evidence pointer.
// First run without any accepted catalog: seed an empty accepted catalog so the
// registered run lane can publish the single verified result it produces.
if (quantTarget && !existsSync(path.join(root, registeredQuantRunCatalogPath))) {
  mkdirSync(path.dirname(path.join(root, registeredQuantRunCatalogPath)), { recursive: true });
  writeFileSync(path.join(root, registeredQuantRunCatalogPath), `${JSON.stringify({
    schemaVersion: "2026-08-17.quant-decision-evidence-catalog.v1",
    generatedAt: new Date().toISOString(),
    entries: quantManifestSha256
      ? [{ symbol, repositoryPath: quantTarget.manifest, sha256: quantManifestSha256 }]
      : []
  }, null, 2)}\n`, { flag: "wx" });
}
const catalogRequired = quantTarget || existsSync(path.join(root, registeredQuantRunCatalogPath));
if (!run("npm", ["run", "build"])) fail("API build failed");
if (!existsSync(serverEntry)) fail("API build did not produce the expected server entry");
if (process.env.LOCAL_ALPHA_EXISTING_SCHEMA_ONLY !== "1"
  && !run("npm", ["run", "migrate"], { DATABASE_URL: databaseUrl })) fail("Database migration failed");
mkdirSync(ocrModuleCache, { recursive: true });
if (spawnSync("xcrun", ["--find", "swiftc"], { stdio: "ignore" }).status === 0) {
  if (!run("xcrun", [
    "swiftc", "-O", "-module-cache-path", ocrModuleCache, "-o", ocrHelperPath, ocrHelperSource
  ], {}, root)) {
    rmSync(ocrHelperPath, { force: true });
    ocrExecutable = null;
    console.warn("Local OCR helper build failed; scanned PDF import degrades to an explicit error.");
  }
} else {
  rmSync(ocrHelperPath, { force: true });
  ocrExecutable = null;
  console.warn("swiftc is unavailable; scanned PDF import degrades to an explicit error.");
}
let builtAppPath = null;
if (simulator || device) {
  if (!run("xcodegen", ["generate", "--quiet"], {}, appRoot)) fail("iOS project generation failed");
  const deviceBuild = Boolean(device);
  const buildArgs = [
    "-project", "AnnualRingsGateAApp.xcodeproj",
    "-scheme", "AnnualRingsGateAApp",
    "-destination", device ? `id=${device}` : "generic/platform=iOS Simulator",
    "-derivedDataPath", derivedDataPath,
    `CODE_SIGNING_ALLOWED=${deviceBuild ? "YES" : "NO"}`,
    "build",
    "-quiet"
  ];
  if (device) buildArgs.splice(-2, 0, `DEVELOPMENT_TEAM=${developmentTeam}`);
  if (experienceLabel) {
    buildArgs.splice(-2, 0,
      `PRODUCT_BUNDLE_IDENTIFIER=${experienceBundleId}`,
      `INFOPLIST_KEY_CFBundleDisplayName=${experienceDisplayName}`);
  }
  if (!run("xcodebuild", buildArgs, {}, appRoot)) fail(`iOS ${deviceBuild ? "device" : "Simulator"} build failed`);
  builtAppPath = path.join(derivedDataPath, `Build/Products/Debug-${deviceBuild ? "iphoneos" : "iphonesimulator"}/AnnualRingsGateAApp.app`);
  if (experienceLabel && !run("/usr/libexec/PlistBuddy", [
    "-c", `Set :CFBundleDisplayName ${experienceDisplayName}`, path.join(builtAppPath, "Info.plist")
  ])) {
    // The bundle uses an explicit Config/Info.plist, so the display name is also written onto the
    // built bundle. A missing label must not block the isolated experience launch.
    console.warn("Experience display name could not be applied to the built bundle; the experience app keeps the ordinary display name.");
  }
  if (simulator) {
    run("xcrun", ["simctl", "boot", simulator]);
    if (!run("xcrun", ["simctl", "bootstatus", simulator, "-b"])) fail("Simulator boot failed");
    if (!run("xcrun", ["simctl", "install", simulator, builtAppPath])) fail("Simulator app install failed");
  }
}

const signingKey = randomBytes(32).toString("base64url");
const readToken = scopedToken(actorId, signingKey, ["read"]);
const writeToken = scopedToken(actorId, signingKey, ["read", "candidate_write", "research_write", "review_write"]);
if (dailyIngestTokenFile) {
  // Optional external credential for a launchd-owned daily ingest job. The token carries the existing
  // read + research_write scopes, so it can also reach any other route those scopes allow; the collector
  // script itself only calls the research material write endpoint.
  writeRuntimeTokenFile(dailyIngestTokenFile, scopedToken(actorId, signingKey, ["read", "research_write"]),
    "LOCAL_ALPHA_DAILY_INGEST_TOKEN_FILE", "Daily ingest token with read+research_write scopes");
}
if (experienceTokenFile && experienceLabel) {
  // Optional external copy of the current write token so the controller can seed clearly synthetic
  // sample facts through the API of an isolated experience runtime. Only an explicit experience label
  // enables it; the token is never printed and is replaced at the next restart.
  writeRuntimeTokenFile(experienceTokenFile, writeToken,
    "LOCAL_ALPHA_EXPERIENCE_TOKEN_FILE", "Experience sample-seeding token with read+write scopes");
}
if (openDSshTarget) {
  startManaged("OpenD SSH tunnel", "ssh", [
    "-N", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
    "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3", "-L",
    `127.0.0.1:${openDPort}:${openDSshRemoteHost}:${openDSshRemotePort}`,
    openDSshTarget
  ], {}, false);
  for (let attempt = 0; attempt < 20 && !(await portIsOpen(openDPort)); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!(await portIsOpen(openDPort))) {
    console.warn("OpenD SSH tunnel did not become reachable; starting with saved research data and degraded market status.");
  }
}
startManaged("Futu bridge", python, [bridgeEntry], {
  FUTU_BRIDGE_HOST: "127.0.0.1",
  FUTU_BRIDGE_PORT: String(bridgePort),
  FUTU_OPEND_HOST: "127.0.0.1",
  FUTU_OPEND_PORT: String(openDPort),
  FUTU_HISTORY_USE_AUTHORITY: historyUseAuthority
}, false);

const apiEnvironment = {
  NODE_ENV: "development",
  DATABASE_URL: databaseUrl,
  HOST: apiHost,
  PORT: String(apiPort),
  MARKET_PROVIDER: "futu-http",
  FUTU_MARKET_DATA_URL: `http://127.0.0.1:${bridgePort}`,
  FUTU_HISTORY_KLINE_URL: `http://127.0.0.1:${bridgePort}/history-kline`,
  PINGAN_CURRENT_PORTFOLIO_ENABLED: "true",
  PINGAN_SNAPSHOT_ACCOUNT_SCOPES: `${actorId}=${accountScope}`,
  RESEARCH_DOCUMENT_RAW_STORE_ROOT: rawStoreRoot,
  RESEARCH_DOCUMENT_OCR_EXECUTABLE: ocrExecutable ?? "",
  REQUIRE_WRITE_AUTH: "true",
  WRITE_API_AUTH_HEADER: "x-internal-token",
  STAGING_READONLY_AUTH_HEADER_NAME: "x-internal-token",
  API_AUTH_SIGNING_KEY: signingKey,
  WRITE_API_TOKEN: "",
  INTERNAL_API_TOKEN: "",
  STAGING_READONLY_MODE: "false",
  STAGING_READONLY_AUTH_TOKEN: "",
  STAGING_READONLY_IDENTITY: "local-alpha",
  API_AUTH_VERIFICATION_KEYS: "",
  API_AUTH_REVOKED_TOKEN_IDS: "",
  ALLOW_LEGACY_WRITE_TOKEN_FOR_SCOPED_LANES: "false",
  RESEARCH_WRITE_ACTOR_ID: actorId,
  QUANT_REGISTERED_RUN_ENABLED: "1",
  ANNUAL_PORTFOLIO_LAB_EVIDENCE_MANIFEST: portfolioQuantManifestSha256 ? portfolioQuantManifestPath : "",
  ANNUAL_PORTFOLIO_LAB_EVIDENCE_MANIFEST_SHA256: portfolioQuantManifestSha256 ?? ""
};
if (aiEnabled) {
  apiEnvironment.RESEARCH_AI_API_KEY = aiApiKey;
  apiEnvironment.RESEARCH_AI_BASE_URL = "https://api.deepseek.com/";
  apiEnvironment.RESEARCH_AI_MODEL = "deepseek-flash";
} else {
  apiEnvironment.RESEARCH_AI_API_KEY = "";
  apiEnvironment.RESEARCH_AI_BASE_URL = "";
  apiEnvironment.RESEARCH_AI_MODEL = "";
}
startManaged("API", process.execPath, [serverEntry], () => {
  // The API publishes a new catalog through an atomic rename. Rebind every
  // child spawn to that published content instead of reusing the parent's
  // startup SHA; the signing key and actor remain from this same parent.
  const bound = bindApiQuantEvidenceEnvironment(apiEnvironment, {
    repositoryRoot: root,
    catalogPath: registeredQuantRunCatalogPath,
    catalogRequired: Boolean(catalogRequired),
    fallbackPath: quantTarget?.manifest,
    fallbackSha256: quantManifestSha256
  });
  if (bound.issue) {
    console.warn(`Published quant catalog could not be fully verified; affected quant reads remain fail-closed: ${bound.issue}`);
  }
  return bound.environment;
});

process.once("SIGINT", () => { void shutdown(0); });
process.once("SIGTERM", () => { void shutdown(0); });

const initialHealth = await waitForReady(`${apiBaseURL}/health/ready`);
if (initialHealth.readiness?.marketData !== "ready") {
  console.warn("Futu/OpenD market data is temporarily unavailable; the app will keep existing research readable and show the degraded source state.");
}
const initialDaily = await refreshDailyWithRetry(apiBaseURL, symbol, writeToken);
if (!initialDaily.ok) {
  console.warn(`Initial daily research refresh remains unavailable for ${symbol}: ${initialDaily.message}`);
}
anomalyMonitorTimer = setInterval(() => { void runAnomalyMonitor(); void runSourceMonitor(); }, anomalyMonitorMinutes * 60_000);
void runAnomalyMonitor();
void runSourceMonitor();
if (simulator) {
  const launched = run("xcrun", ["simctl", "launch", "--terminate-running-process", simulator,
    experienceLabel ? experienceBundleId : bundleId,
    // Tokens stay in the child environment; a relaunch of the dedicated experience app reopens on
    // the same isolated API through its own persisted settings.
    ...(experienceLabel ? ["--persist-debug-connection"] : [])
  ], {
    SIMCTL_CHILD_ANNUAL_RINGS_GATE_A_BASE_URL: `http://127.0.0.1:${apiPort}`,
    SIMCTL_CHILD_ANNUAL_RINGS_GATE_A_SYMBOL: symbol,
    SIMCTL_CHILD_ANNUAL_RINGS_INITIAL_TAB: "today",
    SIMCTL_CHILD_ANNUAL_RINGS_DEBUG_READ_AUTH_TOKEN: readToken,
    SIMCTL_CHILD_ANNUAL_RINGS_DEBUG_WRITE_AUTH_TOKEN: writeToken,
    SIMCTL_CHILD_ANNUAL_RINGS_AUTH_HEADER: "x-internal-token",
    SIMCTL_CHILD_ANNUAL_RINGS_WRITE_AUTH_HEADER: "x-internal-token",
    ...(experienceLabel ? { SIMCTL_CHILD_ANNUAL_RINGS_EXPERIENCE_LABEL: experienceLabel } : {})
  });
  if (!launched) await shutdown(1, "xcrun failed");
} else if (device) {
  if (!run("xcrun", ["devicectl", "device", "install", "app", "--device", device, builtAppPath, "--timeout", "60"])) {
    await shutdown(1, "physical iPhone install failed");
  }
  const environment = JSON.stringify({
    ANNUAL_RINGS_GATE_A_BASE_URL: apiBaseURL,
    ANNUAL_RINGS_GATE_A_SYMBOL: symbol,
    ANNUAL_RINGS_INITIAL_TAB: "today",
    ANNUAL_RINGS_DEBUG_READ_AUTH_TOKEN: readToken,
    ANNUAL_RINGS_DEBUG_WRITE_AUTH_TOKEN: writeToken,
    ANNUAL_RINGS_AUTH_HEADER: "x-internal-token",
    ANNUAL_RINGS_WRITE_AUTH_HEADER: "x-internal-token"
  });
  if (!run("xcrun", ["devicectl", "device", "process", "launch", "--device", device,
    "--terminate-existing", "--environment-variables", environment, bundleId, "--timeout", "30"])) {
    await shutdown(1, "physical iPhone launch failed");
  }
}
console.log(`Local Alpha ready: ${symbol}, actor=${actorId}, API=${apiHost}:${apiPort}, AI=${aiEnabled ? "explicitly enabled" : "disabled"}${experienceLabel ? `, experience=${experienceLabel}` : ""}. Press Ctrl-C to stop.`);
await new Promise(() => {});

function scopedToken(id, key, scopes) {
  // ponytail: runtime-scoped 30-day credentials; add rotation only if a multi-user remote runtime is approved.
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    actorId: id,
    scopes,
    expiresAt: Math.floor(Date.now() / 1000) + localTokenTtlSeconds
  })).toString("base64url");
  return `v1.${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
}

function start(command, args, environment) {
  return spawn(command, args, { cwd: root, env: { ...process.env, ...environment }, stdio: "inherit" });
}

function startManaged(label, command, args, environment, required = true) {
  const service = { label, command, args, environment, required, child: null, restartTimer: null, stableTimer: null, restartAttempts: 0 };
  services.push(service);
  spawnManaged(service);
}

function spawnManaged(service) {
  if (stopping) return;
  let environment;
  try {
    environment = typeof service.environment === "function" ? service.environment() : service.environment;
  } catch (error) {
    void shutdown(1, `${service.label} cannot start: ${error instanceof Error ? error.message : "invalid runtime evidence"}`);
    return;
  }
  const child = start(service.command, service.args, environment);
  service.child = child;
  service.stableTimer = setTimeout(() => { service.restartAttempts = 0; }, 30_000);
  let handled = false;
  const stopped = (detail) => {
    if (handled) return;
    handled = true;
    clearTimeout(service.stableTimer);
    service.stableTimer = null;
    if (service.child === child) service.child = null;
    if (stopping) return;
    service.restartAttempts = Math.min(service.restartAttempts + 1, 6);
    if (service.restartAttempts > 5 && service.required) {
      void shutdown(1, `${service.label} could not recover after 5 attempts (${detail})`);
      return;
    }
    const delay = Math.min(500 * (2 ** (service.restartAttempts - 1)), 5_000);
    console.warn(`${service.label} stopped (${detail}); restarting in ${delay}ms.`);
    service.restartTimer = setTimeout(() => {
      service.restartTimer = null;
      spawnManaged(service);
    }, delay);
  };
  child.once("exit", (code, signal) => stopped(`exit=${code ?? signal ?? "unknown"}`));
  child.once("error", (error) => stopped(error.message));
}

function run(command, args, environment = {}, cwd = root) {
  const result = spawnSync(command, args, { cwd, env: { ...process.env, ...environment }, stdio: "inherit" });
  return result.status === 0;
}

function isLocalPostgresUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return ["postgres:", "postgresql:"].includes(url.protocol)
      && ["", "localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      && url.pathname.length > 1
      && !url.searchParams.has("host");
  } catch {
    return false;
  }
}

async function requirePort(label, port, expectedOpen, host = "127.0.0.1") {
  const open = await portIsOpen(port, host);
  if (open !== expectedOpen) fail(`${label} on ${host}:${port} must be ${expectedOpen ? "reachable" : "free"}`);
}

function portIsOpen(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(700);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
  });
}

function isAssignedPrivateIpv4(host) {
  const octets = host.split(".").map(Number);
  const isPrivate = octets.length === 4 && octets.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)
    && (octets[0] === 10 || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31 || octets[0] === 192 && octets[1] === 168);
  return isPrivate && Object.values(networkInterfaces()).flat().some((address) => address?.family === "IPv4" && address.address === host);
}

async function waitForReady(url) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url);
      const health = await response.json();
      if (response.ok && health.ok && health.readiness?.database === "ready"
        && health.readiness?.schema === "ready" && health.readiness?.rawStore === "ready") return health;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await shutdown(1, "local API did not become ready with PostgreSQL schema and raw document storage");
}

async function refreshDailyWithRetry(baseURL, selectedSymbol, authToken) {
  let result = { ok: false, message: "daily evidence unavailable" };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    result = await refreshDaily(baseURL, selectedSymbol, authToken);
    if (result.ok) return result;
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
  }
  return result;
}

async function refreshDaily(baseURL, selectedSymbol, authToken) {
  const [market, code] = selectedSymbol.split(".");
  try {
    const response = await fetch(`${baseURL}/api/internal/market/daily-bars/refresh/${market}/${code}`, {
      method: "POST",
      headers: { "x-internal-token": authToken }
    });
    const envelope = await response.json();
    if (response.ok && envelope.usableForRequestedCutoff === true) {
      return { ok: true, message: "usable completed-session daily evidence stored" };
    }
    return {
      ok: false,
      message: `${response.status} ${String(envelope.message ?? envelope.status ?? "daily evidence unavailable")}`
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "request failed" };
  }
}

function probeRawStore(directory) {
  let probe;
  try {
    probe = mkdtempSync(path.join(directory, ".local-alpha-ready-"));
    const file = path.join(probe, "probe");
    writeFileSync(file, "ready", { flag: "wx" });
    if (readFileSync(file, "utf8") !== "ready") throw new Error("read-back mismatch");
  } catch (error) {
    fail(`LOCAL_ALPHA_RAW_STORE_ROOT is not writable: ${error instanceof Error ? error.message : "probe failed"}`);
  } finally {
    if (probe) rmSync(probe, { recursive: true, force: true });
  }
}

function requireExternalRawStore(directory, repository) {
  if (!path.isAbsolute(directory)
      || !isOutside(path.resolve(repository), path.resolve(directory))
      || !isOutside(realpathSync(repository), realpathSync(directory))) {
    fail("LOCAL_ALPHA_RAW_STORE_ROOT must be an absolute path outside the repository");
  }
}

function isOutside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== "" && (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative));
}

function writeRuntimeTokenFile(configuredPath, token, envName, description) {
  if (!path.isAbsolute(configuredPath)) {
    fail(`${envName} must be an absolute path`);
  }
  const absolute = path.resolve(configuredPath);
  const repositoryReal = realpathSync(root);
  let parentReal;
  try {
    parentReal = realpathSync(path.dirname(absolute));
  } catch {
    fail(`${envName} parent directory must already exist`);
  }
  if (!statSync(parentReal).isDirectory()) {
    fail(`${envName} parent must be a directory`);
  }
  if (!isOutside(root, absolute) || !isOutside(repositoryReal, path.join(parentReal, path.basename(absolute)))) {
    fail(`${envName} must be an absolute path outside the repository`);
  }
  const existing = lstatSync(absolute, { throwIfNoEntry: false });
  if (existing) {
    if (existing.isSymbolicLink()) fail(`${envName} must not be a symlink`);
    if (!existing.isFile()) fail(`${envName} must be a regular file`);
    if (existing.uid !== process.getuid()) fail(`${envName} must be owned by the current user`);
    // Owner-only mode is enforced before the credential is written; a broader existing mode is tightened first.
    if ((existing.mode & 0o777) !== 0o600) chmodSync(absolute, 0o600);
  }
  writeFileSync(absolute, `${token}\n`, { flag: existing ? "w" : "wx", mode: 0o600 });
  console.log(`${description} exported to ${absolute}; it is valid for this runtime only and is replaced at the next restart.`);
}

async function shutdown(exitCode, message) {
  if (stopping) return;
  stopping = true;
  if (anomalyMonitorTimer) clearInterval(anomalyMonitorTimer);
  sourceMonitorAbort.abort();
  if (message) console.error(message);
  for (const service of services) {
    clearTimeout(service.restartTimer);
    clearTimeout(service.stableTimer);
  }
  await Promise.all(services.map((service) => service.child ? stopChild(service.child) : Promise.resolve()));
  process.exit(exitCode);
}

async function runSourceMonitor() {
  if (stopping || sourceMonitorRunning || Date.now() - sourceMonitorLastCycleAt < sourceMonitorCycleMs) return;
  sourceMonitorRunning = true;
  try {
    const headers = { "x-internal-token": readToken };
    const response = await fetch(`${apiBaseURL}/api/mobile/research/candidate-memberships`, {
      headers, signal: AbortSignal.any([sourceMonitorAbort.signal, AbortSignal.timeout(10_000)])
    });
    if (!response.ok) throw new Error(`membership read HTTP ${response.status}`);
    const envelope = await response.json();
    if (envelope.status !== "available" && envelope.status !== "empty") throw new Error("membership read unavailable");
    sourceMonitorLastCycleAt = Date.now();
    const tracked = (envelope.memberships ?? []).filter((member) => member.actorId === actorId
      && member.state === "tracked" && /^[1-9][0-9]*$/.test(String(member.id))
      && /^HK\.[0-9]{5}$/.test(member.symbol));
    for (const member of tracked) {
      if (stopping) break;
      try {
        const refreshed = await fetch(`${apiBaseURL}/api/mobile/research/candidate-memberships/${member.id}/source-intake/refresh`, {
          method: "POST",
          headers: { "x-internal-token": writeToken, "content-type": "application/json" },
          body: JSON.stringify({ scheduledRefresh: true }),
          signal: AbortSignal.any([sourceMonitorAbort.signal, AbortSignal.timeout(120_000)])
        });
        if (!refreshed.ok) throw new Error(`source refresh HTTP ${refreshed.status}`);
        const result = await refreshed.json();
        if (result.refresh?.discoverySuccess === false || result.refresh?.skipped === "RULES_UNAVAILABLE") {
          console.warn(`Official source monitor ${member.symbol} unavailable; saved research remains readable.`);
        }
      } catch (error) {
        if (stopping) break;
        console.warn(`Official source monitor ${member.symbol} unavailable: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    if (!stopping) console.warn(`Official source monitor degraded: ${error instanceof Error ? error.message : String(error)}`);
  } finally { sourceMonitorRunning = false; }
}

async function runAnomalyMonitor() {
  if (stopping || anomalyMonitorRunning) return;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Hong_Kong", weekday: "short",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const field = (type) => parts.find((part) => part.type === type)?.value;
  const minutes = Number(field("hour")) * 60 + Number(field("minute"));
  if (["Sat", "Sun"].includes(field("weekday")) || !(minutes >= 570 && minutes < 720 || minutes >= 780 && minutes < 960)) return;
  anomalyMonitorRunning = true;
  try {
    const headers = { "x-internal-token": readToken };
    const membershipsResponse = await fetch(`${apiBaseURL}/api/mobile/research/candidate-memberships`, { headers,
      signal: AbortSignal.timeout(10_000) });
    if (!membershipsResponse.ok) return;
    const memberships = await membershipsResponse.json();
    const tracked = (memberships.memberships ?? []).filter((item) => item.state === "tracked" && /^HK\.[0-9]{5}$/.test(item.symbol)).slice(0, 25);
    if (!tracked.length) return;
    const [market, code] = tracked[0].symbol.split(".");
    const environmentResponse = await fetch(`${apiBaseURL}/api/mobile/market/environment/${market}/${code}`, { headers,
      signal: AbortSignal.timeout(10_000) });
    if (!environmentResponse.ok) return;
    const environment = await environmentResponse.json();
    if (environment.status !== "available" || !["MORNING", "AFTERNOON"].includes(environment.data?.marketState)) return;
    for (const member of tracked) {
      try {
        const [memberMarket, memberCode] = member.symbol.split(".");
        const refreshed = await fetch(`${apiBaseURL}/api/internal/market/refresh/${memberMarket}/${memberCode}`,
          { method: "POST", headers: { "x-internal-token": writeToken }, signal: AbortSignal.timeout(15_000) });
        if (!refreshed.ok) continue;
        const quote = await refreshed.json();
        if (quote.status !== "live") continue;
        const observed = await fetch(`${apiBaseURL}/api/mobile/research/candidate-memberships/${member.id}/market-anomaly/observations`,
          { method: "POST", headers: { "x-internal-token": writeToken }, signal: AbortSignal.timeout(25_000) });
        if (!observed.ok) throw new Error(`anomaly observation failed: HTTP ${observed.status}`);
      } catch (error) {
        console.warn(`Local anomaly monitor ${member.symbol} unavailable: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    console.warn(`Local anomaly monitor degraded: ${error instanceof Error ? error.message : String(error)}`);
  } finally { anomalyMonitorRunning = false; }
}

function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const force = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, 2_000);
    child.once("exit", () => { clearTimeout(force); resolve(); });
    if (child.exitCode !== null || child.signalCode !== null) {
      clearTimeout(force);
      resolve();
      return;
    }
    child.kill("SIGTERM");
  });
}

function integer(value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65535) fail("runtime ports must be integers from 1 through 65535");
  return parsed;
}

function normalizeExperienceLabel(value) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  if (/[\p{Cc}\p{Cf}]/u.test(trimmed)) fail("LOCAL_ALPHA_EXPERIENCE_LABEL must not contain control characters");
  if (trimmed.length > 64) fail("LOCAL_ALPHA_EXPERIENCE_LABEL must be 64 characters or fewer");
  return trimmed;
}

function keychainPassword(service) {
  if (process.platform !== "darwin") return null;
  const result = spawnSync("security", ["find-generic-password", "-s", service, "-w"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  const value = result.status === 0 && typeof result.stdout === "string"
    ? result.stdout.trim()
    : "";
  return value.length >= 20 ? value : null;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
