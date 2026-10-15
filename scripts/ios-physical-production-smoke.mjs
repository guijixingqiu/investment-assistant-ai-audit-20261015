import { mkdir, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const appRoot = path.join(root, "apps/ios/AnnualRingsGateA");
const workDir = path.join(root, "artifacts", "ios-physical-production-smoke");
const derivedDataPath = path.join(workDir, "DerivedData");
const deviceListPath = path.join(workDir, "devices.json");
const installJsonPath = path.join(workDir, "install.json");
const launchJsonPath = path.join(workDir, "launch.json");
const bundleId = "com.example.AnnualRingsGateA";
const baseUrl = process.env.PHYSICAL_PRODUCTION_BASE_URL
  ?? process.env.CANDIDATE_PRODUCTION_BASE_URL
  ?? "https://127.0.0.1:18443/candidate-api";
const symbol = process.env.PHYSICAL_PRODUCTION_SYMBOL ?? "HK.09926";
const authTokenEnv = process.env.PHYSICAL_PRODUCTION_AUTH_TOKEN_ENV ?? "PHYSICAL_PRODUCTION_AUTH_TOKEN";
const authToken = process.env[authTokenEnv] ?? "";
const authHeaderName = process.env.PHYSICAL_PRODUCTION_AUTH_HEADER ?? "x-internal-token";
const developmentTeam = process.env.IOS_DEVELOPMENT_TEAM ?? "";
const signingAllowed = process.env.IOS_PHYSICAL_CODE_SIGNING_ALLOWED ?? "YES";
const approvedDevice = process.env.IOS_PHYSICAL_DEVICE_UDID ?? "";

await rm(workDir, { recursive: true, force: true });
await mkdir(workDir, { recursive: true });

const candidateSmoke = await runCandidateSmoke();
const devices = await listPhysicalDevices();
const device = pickDevice(devices);

if (!candidateSmoke.ok) {
  reportAndExit({
    ok: false,
    phase: "candidate-url",
    baseUrl,
    symbol,
    auth: authSummary(),
    candidateSmoke,
    devices: summarizeDevices(devices),
    notes: [
      "Candidate production URL smoke failed before physical installation.",
      "Verify the SSH tunnel or authorized /candidate-api/ nginx overlay first.",
      "This command does not modify production nginx or production data."
    ]
  });
}

if (!device) {
  reportAndExit({
    ok: false,
    phase: "device",
    baseUrl,
    symbol,
    auth: authSummary(),
    candidateSmoke,
    devices: summarizeDevices(devices),
    notes: [
      approvedDevice
        ? "The explicitly approved physical iPhone was not available."
        : "IOS_PHYSICAL_DEVICE_UDID must explicitly identify the approved physical iPhone.",
      "This command does not modify production nginx or production data."
    ]
  });
}

await run("xcodegen", ["generate", "--quiet"], { cwd: appRoot });

const buildArgs = [
  "-project", "AnnualRingsGateAApp.xcodeproj",
  "-scheme", "AnnualRingsGateAApp",
  "-destination", `id=${device.udid}`,
  "-derivedDataPath", derivedDataPath,
  "build",
  `CODE_SIGNING_ALLOWED=${signingAllowed}`,
  "-quiet"
];
if (developmentTeam) {
  buildArgs.splice(-1, 0, `DEVELOPMENT_TEAM=${developmentTeam}`);
}
await run("xcodebuild", buildArgs, { cwd: appRoot });

const appPath = path.join(derivedDataPath, "Build/Products/Debug-iphoneos/AnnualRingsGateAApp.app");
await ensureAppExists(appPath);
await run("xcrun", [
  "devicectl", "device", "install", "app",
  "--device", device.udid,
  appPath,
  "--json-output", installJsonPath,
  "--timeout", "60"
]);
await run("xcrun", [
  "devicectl", "device", "process", "launch",
  "--device", device.udid,
  "--terminate-existing",
  "--environment-variables", JSON.stringify({
    ANNUAL_RINGS_GATE_A_BASE_URL: baseUrl,
    ANNUAL_RINGS_GATE_A_SYMBOL: symbol,
    ANNUAL_RINGS_DEBUG_READ_AUTH_TOKEN: authToken,
    ANNUAL_RINGS_AUTH_HEADER: authHeaderName
  }),
  bundleId,
  "--json-output", launchJsonPath,
  "--timeout", "30"
]);

reportAndExit({
  ok: true,
  phase: "complete",
  baseUrl,
  symbol,
  auth: authSummary(),
  candidateSmoke,
  device: {
    name: device.name,
    deviceFingerprint: deviceFingerprint(device),
    state: device.state,
    osVersion: device.osVersion ?? null
  },
  artifacts: {
    installJsonPath,
    launchJsonPath
  }
});

async function runCandidateSmoke() {
  try {
    const result = await execFileAsync("node", ["scripts/candidate-production-url-smoke.mjs"], {
      env: {
        ...process.env,
        CANDIDATE_PRODUCTION_BASE_URL: baseUrl,
        CANDIDATE_PRODUCTION_SYMBOL: symbol,
        CANDIDATE_PRODUCTION_AUTH_TOKEN_ENV: authTokenEnv,
        CANDIDATE_PRODUCTION_AUTH_HEADER: authHeaderName
      },
      maxBuffer: 5 * 1024 * 1024
    });
    return {
      ok: true,
      output: JSON.parse(result.stdout)
    };
  } catch (error) {
    return {
      ok: false,
      exitCode: error.code ?? null,
      stdoutPreview: String(error.stdout ?? "").slice(0, 1000),
      stderrPreview: String(error.stderr ?? "").slice(0, 1000),
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

async function listPhysicalDevices() {
  try {
    await run("xcrun", [
      "devicectl", "list", "devices",
      "--json-output", deviceListPath,
      "--timeout", "10"
    ], { silent: true });
    const payload = JSON.parse(await readText(deviceListPath));
    return (payload.result?.devices ?? [])
      .filter((device) => device.hardwareProperties?.deviceType === "iPhone")
      .map((device) => ({
        name: device.deviceProperties?.name ?? "unknown iPhone",
        identifier: device.identifier,
        udid: device.hardwareProperties?.udid,
        state: device.connectionProperties?.tunnelState ?? "unknown",
        pairingState: device.connectionProperties?.pairingState ?? "unknown",
        developerModeStatus: device.deviceProperties?.developerModeStatus ?? "unknown",
        osVersion: device.deviceProperties?.osVersion
          ?? device.hardwareProperties?.osVersion
          ?? device.deviceProperties?.ddiServicesAvailable?.version
          ?? null
      }));
  } catch (error) {
    return [{
      name: "device-list-error",
      identifier: null,
      udid: null,
      state: "error",
      error: error instanceof Error ? error.message : String(error)
    }];
  }
}

function pickDevice(devices) {
  const candidates = devices.filter((device) => device.udid && device.state !== "unavailable" && device.state !== "error");
  if (!approvedDevice) {
    return null;
  }
  return candidates.find((device) => device.udid === approvedDevice || device.identifier === approvedDevice) ?? null;
}

function summarizeDevices(devices) {
  return devices.map((device) => ({
    name: device.name,
    deviceFingerprint: deviceFingerprint(device),
    state: device.state,
    pairingState: device.pairingState,
    developerModeStatus: device.developerModeStatus,
    osVersion: device.osVersion ?? null
  }));
}

function deviceFingerprint(device) {
  const value = device.udid ?? device.identifier;
  return value ? createHash("sha256").update(value).digest("hex").slice(0, 16) : null;
}

function authSummary() {
  return {
    headerName: authHeaderName,
    tokenProvided: authToken.length > 0,
    tokenEnv: authTokenEnv
  };
}

async function ensureAppExists(appPath) {
  try {
    const app = await stat(appPath);
    if (!app.isDirectory()) {
      throw new Error(`${appPath} is not a directory`);
    }
  } catch (error) {
    throw new Error(`built app not found at ${appPath}: ${error.message}`);
  }
}

async function run(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    cwd: options.cwd ?? root,
    env: process.env,
    maxBuffer: 30 * 1024 * 1024
  });
  if (!options.silent) {
    if (result.stdout.trim()) console.log(result.stdout.trim());
    if (result.stderr.trim()) console.error(result.stderr.trim());
  }
  return result;
}

async function readText(filePath) {
  const { readFile } = await import("node:fs/promises");
  return readFile(filePath, "utf8");
}

function reportAndExit(payload) {
  console.log(JSON.stringify(payload, null, 2));
  if (!payload.ok) {
    process.exit(1);
  }
}
