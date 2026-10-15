#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const baseUrl = process.env.CLIENT_CANDIDATE_API_BASE_URL
  ?? process.env.CANDIDATE_PRODUCTION_BASE_URL
  ?? "https://audit-service.example.invalid:18443/candidate-api";
const productionBaseUrl = process.env.CLIENT_CANDIDATE_LEGACY_BASE_URL
  ?? process.env.PRODUCTION_BASE_URL
  ?? "https://audit-service.example.invalid:18443";
const symbol = process.env.CLIENT_CANDIDATE_API_SYMBOL ?? "HK.09926";
const deferPhysicalDevice = process.env.CLIENT_CANDIDATE_DEFER_PHYSICAL_DEVICE ?? "1";
const marketClosed = process.env.CLIENT_CANDIDATE_MARKET_CLOSED ?? process.env.CANDIDATE_MARKET_CLOSED ?? "0";
const tlsInsecure = process.env.CLIENT_CANDIDATE_TLS_INSECURE ?? process.env.CANDIDATE_PRODUCTION_TLS_INSECURE ?? "0";
const authHeader = process.env.CLIENT_CANDIDATE_AUTH_HEADER ?? "x-internal-token";

const checks = [];
const blockers = [];

check("client candidate base URL uses /candidate-api", isHttpUrl(baseUrl) && baseUrl.includes("/candidate-api"), {
  present: Boolean(baseUrl),
  valuePrinted: false
});
check("legacy production base URL excludes /candidate-api", isHttpUrl(productionBaseUrl) && !productionBaseUrl.includes("/candidate-api"), {
  present: Boolean(productionBaseUrl),
  valuePrinted: false
});
check("symbol is MARKET.CODE", /^[A-Z]+\.[0-9A-Z]+$/.test(symbol), { symbol });

let factSource = null;
let candidateSmoke = null;
let iosClient = null;
let blockersRun = null;

if (blockers.length === 0) {
  factSource = await runJson("node", ["scripts/fact-source-switch-readiness.mjs"], {
  FACT_SOURCE_SWITCH_MODE: "client_candidate_api",
  FACT_SOURCE_CANDIDATE_BASE_URL: baseUrl,
  FACT_SOURCE_LEGACY_BASE_URL: productionBaseUrl,
  FACT_SOURCE_SWITCH_SYMBOL: symbol
  });
  check("bounded fact source switch readiness dry-run passes", factSource.output?.ok === true, summarizeRun(factSource));
}

if (blockers.length === 0) {
  candidateSmoke = await runJson("node", ["scripts/candidate-production-url-smoke.mjs"], {
  CANDIDATE_PRODUCTION_BASE_URL: baseUrl,
  CANDIDATE_PRODUCTION_SYMBOL: symbol,
  CANDIDATE_PRODUCTION_TLS_INSECURE: tlsInsecure,
  CANDIDATE_MARKET_CLOSED: marketClosed,
  CANDIDATE_PRODUCTION_AUTH_HEADER: authHeader
  });
  check("candidate production URL read smoke passes", candidateSmoke.output?.ok === true, summarizeRun(candidateSmoke));
}

if (blockers.length === 0) {
  iosClient = await runCommand("npm", ["run", "ios-production-client-smoke"], {
  IOS_PRODUCTION_CLIENT_BASE_URL: baseUrl,
  IOS_PRODUCTION_CLIENT_SYMBOL: symbol,
  IOS_PRODUCTION_CLIENT_TLS_INSECURE: tlsInsecure,
  IOS_PRODUCTION_CLIENT_MARKET_CLOSED: marketClosed,
  IOS_PRODUCTION_CLIENT_AUTH_HEADER: authHeader
  });
  check("iOS Swift client reads candidate production API", iosClient.exitCode === 0, summarizeRun(iosClient));
}

if (blockers.length === 0) {
  blockersRun = await runJson("node", ["scripts/final-cutover-blockers.mjs"], {
  FINAL_CUTOVER_USE_CANDIDATE_URL_FOR_IOS: "1",
  FINAL_CUTOVER_DEFER_PHYSICAL_DEVICE: deferPhysicalDevice,
  CANDIDATE_PRODUCTION_BASE_URL: baseUrl,
  PRODUCTION_BASE_URL: productionBaseUrl,
  FINAL_CUTOVER_SYMBOL: symbol,
  CANDIDATE_MARKET_CLOSED: marketClosed,
  CANDIDATE_PRODUCTION_TLS_INSECURE: tlsInsecure,
  PRODUCTION_TLS_INSECURE: tlsInsecure
  });
  check("final cutover blockers pass in client candidate mode", blockersRun.output?.ok === true, summarizeRun(blockersRun));
}

const result = {
  ok: blockers.length === 0,
  checkedAt: new Date().toISOString(),
  mode: "client_candidate_api",
  symbol,
  urls: {
    clientCandidateBaseUrl: baseUrl,
    legacyProductionBaseUrl: productionBaseUrl
  },
  physicalDevice: {
    deferred: deferPhysicalDevice === "1",
    reason: deferPhysicalDevice === "1" ? "physical iPhone is unavailable in this phase" : null
  },
  safety: {
    writesProductionFacts: false,
    deploysNginx: false,
    reloadsServices: false,
    switchesLegacyApiProxy: false,
    enablesCandidateWriteToken: false
  },
  checks,
  blockers,
  runs: {
    factSourceSwitchReadiness: summarizeRun(factSource),
    candidateProductionUrlSmoke: summarizeRun(candidateSmoke),
    iosProductionClientSmoke: summarizeRun(iosClient),
    finalCutoverBlockers: summarizeRun(blockersRun)
  },
  goNoGo: blockers.length === 0
    ? "client_candidate_api_switch_verified"
    : "no_go_clear_client_candidate_api_switch_blockers",
  notes: [
    "This verifier proves the bounded client_candidate_api path only.",
    "It does not modify nginx, reload services, enable write tokens, write production facts, or switch the legacy /api proxy.",
    "The iOS client must use the candidate base URL as the app base URL; the Swift clients append /api/mobile/... under that base.",
    "Physical-device smoke may be explicitly deferred, but it is not reported as passed."
  ]
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}

function check(id, ok, evidence = {}) {
  const item = { id, ok, evidence };
  checks.push(item);
  if (!ok) {
    blockers.push({ id, evidence });
  }
}

async function runJson(command, args, envOverrides) {
  const run = await runCommand(command, args, envOverrides);
  return {
    ...run,
    output: parseJsonOutput(run.stdout)
  };
}

async function runCommand(command, args, envOverrides) {
  try {
    const result = await execFileAsync(command, args, {
      env: {
        ...process.env,
        ...envOverrides
      },
      maxBuffer: 20 * 1024 * 1024
    });
    return {
      ok: true,
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
      stdoutPreview: sanitize(result.stdout),
      stderrPreview: sanitize(result.stderr)
    };
  } catch (error) {
    return {
      ok: false,
      exitCode: error.code ?? null,
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? ""),
      stdoutPreview: sanitize(error.stdout),
      stderrPreview: sanitize(error.stderr),
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function summarizeRun(run) {
  if (!run) return null;
  return {
    ok: run.output?.ok === true || run.exitCode === 0,
    exitCode: run.exitCode,
    stdoutPreview: run.stdoutPreview || undefined,
    stderrPreview: run.stderrPreview || undefined
  };
}

function parseJsonOutput(text) {
  const trimmed = String(text ?? "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

function sanitize(value) {
  return String(value ?? "")
    .replace(/(TOKEN|PASSWORD|DATABASE_URL)=([^\\s]+)/gi, "$1=<redacted>")
    .slice(0, 1200);
}

function isHttpUrl(value) {
  return /^https?:\/\//.test(String(value ?? ""));
}
