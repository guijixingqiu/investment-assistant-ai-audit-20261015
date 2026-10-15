import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const baseUrl = process.env.PRODUCTION_BASE_URL ?? "https://127.0.0.1:18443";
const symbol = process.env.PRODUCTION_SYMBOL ?? "HK.09926";
const requireAuthorized = process.env.IOS_PRODUCTION_REQUIRE_AUTHORIZED === "1";
const tlsInsecure = process.env.PRODUCTION_TLS_INSECURE === "1";
const authHeaderName = process.env.PRODUCTION_AUTH_HEADER ?? "x-internal-token";
const authTokenEnv = process.env.PRODUCTION_AUTH_TOKEN_ENV ?? "PRODUCTION_AUTH_TOKEN";
const authToken = process.env[authTokenEnv] ?? "";

if (tlsInsecure) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const health = await probe("/health");
const quote = await probe(`/api/mobile/market/quotes/${symbol.replace(".", "/")}`);
const research = await probe(`/api/mobile/research/profiles/${symbol.replace(".", "/")}`);
const devices = await listDevices();

const onlinePhysicalDevices = devices.filter((device) => device.kind === "device" && device.online);
const offlinePhysicalDevices = devices.filter((device) => device.kind === "device" && !device.online);
const quoteAuthorized = quote.ok && quote.status >= 200 && quote.status < 300;
const researchAuthorized = research.ok && research.status >= 200 && research.status < 300;
const authReady = quoteAuthorized && researchAuthorized;

const result = {
  ok: requireAuthorized ? authReady && onlinePhysicalDevices.length > 0 : true,
  baseUrl,
  symbol,
  requireAuthorized,
  tlsInsecure,
  auth: {
    headerName: authHeaderName,
    tokenProvided: authToken.length > 0,
    tokenEnv: authTokenEnv
  },
  probes: {
    health: summarizeProbe(health),
    quote: summarizeProbe(quote),
    research: summarizeProbe(research)
  },
  devices: {
    onlinePhysical: onlinePhysicalDevices.map((device) => device.name),
    offlinePhysical: offlinePhysicalDevices.map((device) => device.name)
  },
  readiness: {
    productionUrlReachable: health.reachable || quote.reachable || research.reachable,
    mobileApiAuthorized: authReady,
    physicalDeviceOnline: onlinePhysicalDevices.length > 0
  },
  notes: [
    "This preflight is read-only.",
    "PRODUCTION_TLS_INSECURE=1 only relaxes TLS validation for this Node preflight process.",
    "HTTP 401/403 means the production URL exists but iOS production login/token validation is not ready.",
    "An offline physical device means true iOS device installation remains unverified.",
    "Set IOS_PRODUCTION_REQUIRE_AUTHORIZED=1 to make missing production auth or device availability fail the command.",
    "Set PRODUCTION_AUTH_TOKEN through the environment; the token value is never printed."
  ]
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}

async function probe(requestPath) {
  const url = new URL(requestPath, baseUrl);
  try {
    const response = await fetch(url, {
      headers: requestHeaders(),
      signal: AbortSignal.timeout(8_000)
    });
    const text = await response.text();
    return {
      reachable: true,
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      bodyPreview: text.slice(0, 200)
    };
  } catch (error) {
    return {
      reachable: false,
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function requestHeaders() {
  return {
    accept: "application/json",
    ...(authToken ? { [authHeaderName]: authToken } : {})
  };
}

async function listDevices() {
  try {
    const result = await execFileAsync("xcrun", ["xctrace", "list", "devices"], {
      maxBuffer: 10 * 1024 * 1024
    });
    return parseDevices(result.stdout);
  } catch (error) {
    return [{
      kind: "device-list-error",
      name: error instanceof Error ? error.message : String(error),
      online: false
    }];
  }
}

function parseDevices(text) {
  const devices = [];
  let section = "";
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === "== Devices ==") {
      section = "devices";
      continue;
    }
    if (trimmed === "== Devices Offline ==") {
      section = "offline";
      continue;
    }
    if (trimmed === "== Simulators ==") {
      section = "simulators";
      continue;
    }
    if (!["devices", "offline"].includes(section)) continue;
    if (trimmed.includes("Mac mini") || trimmed.includes("MacBook") || trimmed.includes("Mac Studio")) continue;
    if (trimmed.includes("Apple") && trimmed.includes("Watch")) continue;
    devices.push({
      kind: "device",
      name: trimmed.replace(/\s+\([0-9A-F-]{8,}.*$/, ""),
      online: section === "devices",
      raw: trimmed
    });
  }
  return devices;
}

function summarizeProbe(probeResult) {
  return {
    reachable: probeResult.reachable,
    ok: probeResult.ok,
    status: probeResult.status,
    contentType: probeResult.contentType,
    error: probeResult.error,
    bodyPreview: probeResult.bodyPreview
  };
}
