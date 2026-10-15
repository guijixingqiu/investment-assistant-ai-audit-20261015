import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { evaluateCandidateQuoteGate } from "./lib/candidate-quote-gate.mjs";

const execFileAsync = promisify(execFile);

const baseUrl = process.env.CANDIDATE_PRODUCTION_BASE_URL ?? "https://127.0.0.1:18443/candidate-api";
const symbol = process.env.CANDIDATE_PRODUCTION_SYMBOL ?? "HK.09926";
const tlsInsecure = process.env.CANDIDATE_PRODUCTION_TLS_INSECURE === "1";
const authHeaderName = process.env.CANDIDATE_PRODUCTION_AUTH_HEADER ?? "x-internal-token";
const authTokenEnv = process.env.CANDIDATE_PRODUCTION_AUTH_TOKEN_ENV ?? "CANDIDATE_PRODUCTION_AUTH_TOKEN";
const authToken = process.env[authTokenEnv] ?? "";

const checks = [];
const blockers = [];

check("candidate base url includes /candidate-api", baseUrl.includes("/candidate-api"), {
  present: Boolean(baseUrl),
  valuePrinted: false
});

const childEnv = buildChildEnv();
const recovery = await runStep(
  "quoteRecoveryDryRun",
  commandSpec("CANDIDATE_POST_RECOVERY_QUOTE_COMMAND", {
    command: process.execPath,
    args: ["scripts/candidate-production-quote-recovery.mjs"]
  }),
  childEnv
);

const quoteGate = recovery.json?.quoteGate?.before
  ?? evaluateCandidateQuoteGate({
    status: recovery.json?.before?.status,
    asOf: recovery.json?.before?.asOf,
    source: {
      provider: recovery.json?.before?.provider,
      providerStatus: recovery.json?.before?.providerStatus,
      fetchedAt: recovery.json?.before?.fetchedAt
    },
    data: {
      quoteTime: recovery.json?.before?.quoteTime
    }
  });
const quoteAcceptable = recovery.ok && quoteGate?.ok === true && [
  "quote_already_live_no_refresh_needed",
  "quote_recent_market_closed_stale_no_refresh_needed"
].includes(recovery.json?.goNoGo);
check("candidate quote acceptable before post-recovery smoke", quoteAcceptable, {
  ok: recovery.ok,
  goNoGo: recovery.json?.goNoGo ?? null,
  quoteStatus: recovery.json?.before?.status ?? null,
  quoteGate,
  error: recovery.error
});

let productionUrlSmoke = null;
let iosClientSmoke = null;

if (blockers.length === 0) {
  productionUrlSmoke = await runStep(
    "candidateProductionUrlSmoke",
    commandSpec("CANDIDATE_POST_RECOVERY_URL_SMOKE_COMMAND", {
      command: process.execPath,
      args: ["scripts/candidate-production-url-smoke.mjs"]
    }),
    childEnv
  );
  check("candidate production URL smoke passed", productionUrlSmoke.ok && productionUrlSmoke.json?.ok === true, {
    ok: productionUrlSmoke.ok,
    quoteStatus: productionUrlSmoke.json?.quote?.status ?? null,
    provider: productionUrlSmoke.json?.quote?.provider ?? null,
    error: productionUrlSmoke.error
  });
}

if (blockers.length === 0) {
  iosClientSmoke = await runStep(
    "iosProductionClientSmoke",
    commandSpec("CANDIDATE_POST_RECOVERY_IOS_SMOKE_COMMAND", {
      command: "npm",
      args: ["run", "ios-production-client-smoke"]
    }),
    childEnv
  );
  check("iOS production client smoke passed", iosClientSmoke.ok, {
    stdoutPreview: iosClientSmoke.stdoutPreview,
    stderrPreview: iosClientSmoke.stderrPreview,
    error: iosClientSmoke.error
  });
}

const result = {
  ok: blockers.length === 0,
  checkedAt: new Date().toISOString(),
  baseUrl,
  symbol,
  mode: {
    tlsInsecure,
    sendsRefreshPost: false,
    deploysNginx: false,
    freezesLegacyApi: false,
    switchesFactSource: false
  },
  auth: {
    headerName: authHeaderName,
    tokenProvided: authToken.length > 0,
    tokenEnv: authTokenEnv,
    tokenPrinted: false
  },
  steps: {
    quoteRecoveryDryRun: summarizeStep(recovery),
    candidateProductionUrlSmoke: summarizeStep(productionUrlSmoke),
    iosProductionClientSmoke: summarizeStep(iosClientSmoke)
  },
  checks,
  blockers,
  goNoGo: blockers.length === 0 ? "post_recovery_smoke_passed" : "no_go_post_recovery_smoke_failed",
  notes: [
    "This verifier does not refresh quotes; it requires the candidate quote to be live, or explicitly market-closed stale with recent Futu fetchedAt.",
    "Market-closed stale acceptance requires CANDIDATE_MARKET_CLOSED=1 and does not relabel the quote as live.",
    "It sends no production write requests.",
    "It does not deploy nginx, reload services, freeze legacy endpoints, write legacy data, write trades, write true positions, write reviews, or switch fact source.",
    "Token values are never printed."
  ]
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}

function buildChildEnv() {
  return {
    ...process.env,
    CANDIDATE_PRODUCTION_BASE_URL: baseUrl,
    CANDIDATE_PRODUCTION_SYMBOL: symbol,
    CANDIDATE_PRODUCTION_TLS_INSECURE: tlsInsecure ? "1" : "0",
    CANDIDATE_PRODUCTION_AUTH_HEADER: authHeaderName,
    CANDIDATE_PRODUCTION_AUTH_TOKEN_ENV: authTokenEnv,
    IOS_PRODUCTION_CLIENT_BASE_URL: process.env.IOS_PRODUCTION_CLIENT_BASE_URL ?? baseUrl,
    IOS_PRODUCTION_CLIENT_SYMBOL: process.env.IOS_PRODUCTION_CLIENT_SYMBOL ?? symbol,
    IOS_PRODUCTION_CLIENT_TLS_INSECURE: process.env.IOS_PRODUCTION_CLIENT_TLS_INSECURE ?? (tlsInsecure ? "1" : "0"),
    IOS_PRODUCTION_CLIENT_AUTH_HEADER: process.env.IOS_PRODUCTION_CLIENT_AUTH_HEADER ?? authHeaderName,
    IOS_PRODUCTION_CLIENT_AUTH_TOKEN: process.env.IOS_PRODUCTION_CLIENT_AUTH_TOKEN ?? authToken
  };
}

function commandSpec(envName, fallback) {
  const raw = process.env[envName];
  if (!raw) return fallback;
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed.command !== "string" || !Array.isArray(parsed.args)) {
    throw new Error(`${envName} must be a JSON object with command and args`);
  }
  return {
    command: parsed.command,
    args: parsed.args.map(String)
  };
}

async function runStep(id, spec, env) {
  try {
    const result = await execFileAsync(spec.command, spec.args, {
      env,
      maxBuffer: 1024 * 1024
    });
    return normalizeStep(id, true, result.stdout, result.stderr, null);
  } catch (error) {
    return normalizeStep(
      id,
      false,
      String(error.stdout ?? ""),
      String(error.stderr ?? ""),
      error instanceof Error ? error.message : String(error)
    );
  }
}

function normalizeStep(id, ok, stdout, stderr, error) {
  return {
    id,
    ok,
    json: parseJson(stdout),
    stdoutPreview: preview(stdout),
    stderrPreview: preview(stderr),
    error
  };
}

function parseJson(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function preview(value) {
  return String(value ?? "").trim().slice(0, 300);
}

function summarizeStep(step) {
  if (!step) return null;
  return {
    ok: step.ok,
    jsonOk: step.json?.ok ?? null,
    goNoGo: step.json?.goNoGo ?? null,
    stdoutPreview: step.json ? null : step.stdoutPreview,
    stderrPreview: step.stderrPreview,
    error: step.error
  };
}

function check(id, ok, evidence = undefined) {
  checks.push({ id, ok, evidence });
  if (!ok) {
    blockers.push({ id, evidence });
  }
}
