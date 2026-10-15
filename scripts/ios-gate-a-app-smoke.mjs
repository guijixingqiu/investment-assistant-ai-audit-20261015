import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { request } from "node:http";

const execFileAsync = promisify(execFile);
const databaseName = `annual_rings_ios_gate_a_${Date.now()}`;
const databaseUrl = `postgres://localhost/${databaseName}`;
const port = 4510;
const root = process.cwd();
const workDir = path.join(root, "artifacts", "ios-gate-a-smoke");
const derivedDataPath = path.join(workDir, "DerivedData");
const screenshotPath = path.join(workDir, "gate-a-app.png");
const liveScreenshotPath = path.join(workDir, "gate-a-live.png");
const staleScreenshotPath = path.join(workDir, "gate-a-stale.png");
const unavailableScreenshotPath = path.join(workDir, "gate-a-unavailable.png");
const researchScreenshotPath = path.join(workDir, "gate-b-research.png");
const bundleId = "com.example.AnnualRingsGateA";
let server;

try {
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });
  await run("createdb", [databaseName]);
  console.log(`created ${databaseName}`);
  await run("npm", ["run", "migrate"], { DATABASE_URL: databaseUrl });

  server = spawn(process.execPath, ["dist/apps/api/src/server.js"], {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      MARKET_PROVIDER: "fixture",
      HOST: "127.0.0.1",
      PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  server.stdout.on("data", (chunk) => process.stdout.write(chunk));

  await waitForHealth(port);
  await jsonRequest("POST", port, "/api/internal/market/refresh/HK/09926");
  const seededResearch = await jsonRequest("POST", port, "/api/internal/research/seed-fixture");

  await run("xcodegen", ["generate", "--quiet"], {
    cwd: path.join(root, "apps/ios/AnnualRingsGateA")
  });
  await run("xcodebuild", [
    "-project", "AnnualRingsGateAApp.xcodeproj",
    "-scheme", "AnnualRingsGateAApp",
    "-destination", "generic/platform=iOS Simulator",
    "-derivedDataPath", derivedDataPath,
    "build",
    "CODE_SIGNING_ALLOWED=NO",
    "-quiet"
  ], {
    cwd: path.join(root, "apps/ios/AnnualRingsGateA")
  });

  const appPath = path.join(derivedDataPath, "Build/Products/Debug-iphonesimulator/AnnualRingsGateAApp.app");
  const udid = await pickSimulator();
  await bootSimulator(udid);
  await run("xcrun", ["simctl", "install", udid, appPath]);
  await captureState(udid, "HK.09926", liveScreenshotPath);

  await run("psql", [
    "-d",
    databaseName,
    "-Atc",
    "update market_quotes set quote_time = now() - interval '10 minutes' where market = 'HK' and code = '09926';"
  ]);
  await captureState(udid, "HK.09926", staleScreenshotPath);
  await captureState(udid, "HK.00000", unavailableScreenshotPath);
  await captureResearchState(udid, researchScreenshotPath);
  const beforeDecision = await jsonRequest("GET", port, "/api/mobile/research/profiles/HK/09926");
  const originalThesis = beforeDecision.data.profile.currentThesis;
  await jsonRequest("POST", port, `/api/internal/research/suggestions/${seededResearch.suggestionId}/decision`, {
    action: "accepted",
    note: "iOS smoke accepted suggestion; thesis unchanged."
  });
  const afterDecision = await jsonRequest("GET", port, "/api/mobile/research/profiles/HK/09926");
  const decidedSuggestion = afterDecision.data.suggestions.find((suggestion) => suggestion.id === seededResearch.suggestionId);
  if (decidedSuggestion?.status !== "accepted") {
    throw new Error(`expected accepted research suggestion, got ${JSON.stringify(decidedSuggestion)}`);
  }
  if (afterDecision.data.profile.currentThesis !== originalThesis) {
    throw new Error("Gate B research decision unexpectedly changed currentThesis.");
  }
  await run("cp", [liveScreenshotPath, screenshotPath]);

  console.log(`Gate A/B iOS app smoke passed. Screenshots: ${liveScreenshotPath}, ${staleScreenshotPath}, ${unavailableScreenshotPath}, ${researchScreenshotPath}`);
} finally {
  if (server) {
    server.kill("SIGTERM");
  }
  try {
    await run("dropdb", ["--if-exists", databaseName]);
    console.log(`dropped ${databaseName}`);
  } catch (error) {
    console.error(`未验证: failed to drop temporary database ${databaseName}.`);
    throw error;
  }
}

async function captureState(udid, symbol, outputPath) {
  await run("xcrun", ["simctl", "launch", "--terminate-running-process", udid, bundleId], {
    SIMCTL_CHILD_ANNUAL_RINGS_GATE_A_BASE_URL: `http://127.0.0.1:${port}`,
    SIMCTL_CHILD_ANNUAL_RINGS_GATE_A_SYMBOL: symbol,
    SIMCTL_CHILD_ANNUAL_RINGS_INITIAL_TAB: "market"
  });
  await sleep(2_500);
  await run("xcrun", ["simctl", "io", udid, "screenshot", outputPath]);
  const screenshot = await stat(outputPath);
  if (screenshot.size < 10_000) {
    throw new Error(`${symbol} screenshot is unexpectedly small: ${screenshot.size} bytes`);
  }
}

async function captureResearchState(udid, outputPath) {
  await run("xcrun", ["simctl", "launch", "--terminate-running-process", udid, bundleId], {
    SIMCTL_CHILD_ANNUAL_RINGS_GATE_A_BASE_URL: `http://127.0.0.1:${port}`,
    SIMCTL_CHILD_ANNUAL_RINGS_GATE_A_SYMBOL: "HK.09926",
    SIMCTL_CHILD_ANNUAL_RINGS_INITIAL_TAB: "research"
  });
  await sleep(3_000);
  await run("xcrun", ["simctl", "io", udid, "screenshot", outputPath]);
  const screenshot = await stat(outputPath);
  if (screenshot.size < 10_000) {
    throw new Error(`research screenshot is unexpectedly small: ${screenshot.size} bytes`);
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

async function waitForHealth(portNumber) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const health = await jsonRequest("GET", portNumber, "/health");
      if (health.ok) {
        return;
      }
    } catch {
      await sleep(250);
    }
  }
  throw new Error("candidate API did not become healthy");
}

function jsonRequest(method, portNumber, requestPath, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = request({
      method,
      hostname: "127.0.0.1",
      port: portNumber,
      path: requestPath,
      headers: {
        accept: "application/json",
        ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {})
      }
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${method} ${requestPath} returned ${res.statusCode}: ${body}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function run(command, args, options = {}) {
  const env = {
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
    ...(options.DATABASE_URL ? { DATABASE_URL: options.DATABASE_URL } : {})
  };
  const result = await execFileAsync(command, args, {
    cwd: options.cwd ?? root,
    env,
    maxBuffer: 20 * 1024 * 1024
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
