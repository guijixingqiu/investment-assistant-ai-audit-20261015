import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const candidateBaseUrl = process.env.CANDIDATE_PRODUCTION_BASE_URL ?? "https://127.0.0.1:18443/candidate-api";
const productionBaseUrl = process.env.PRODUCTION_BASE_URL ?? "https://127.0.0.1:18443";
const symbol = process.env.FINAL_CUTOVER_SYMBOL ?? "HK.09926";
const deferPhysicalDevice = process.env.FINAL_CUTOVER_DEFER_PHYSICAL_DEVICE === "1";
const useCandidateUrlForIosProduction = process.env.FINAL_CUTOVER_USE_CANDIDATE_URL_FOR_IOS === "1";

const candidate = await runJson("node", ["scripts/candidate-production-url-smoke.mjs"], {
  CANDIDATE_PRODUCTION_BASE_URL: candidateBaseUrl,
  CANDIDATE_PRODUCTION_SYMBOL: symbol
});
const productionPreflight = await runJson("node", ["scripts/ios-production-url-preflight.mjs"], {
  PRODUCTION_BASE_URL: productionBaseUrl,
  PRODUCTION_SYMBOL: symbol,
  IOS_PRODUCTION_REQUIRE_AUTHORIZED: "1"
});
const physical = await runJson("node", ["scripts/ios-physical-production-smoke.mjs"], {
  PHYSICAL_PRODUCTION_BASE_URL: candidateBaseUrl,
  PHYSICAL_PRODUCTION_SYMBOL: symbol
});

const blockers = [
  ...candidateBlockers(candidate),
  ...productionPreflightBlockers(productionPreflight),
  ...physicalBlockers(physical)
];
const deferred = deferPhysicalDevice ? deferredPhysicalChecks(productionPreflight, physical) : [];

const result = {
  ok: blockers.length === 0,
  symbol,
  urls: {
    candidateBaseUrl,
    productionBaseUrl
  },
  checks: {
    candidateProductionUrl: summarizeRun(candidate),
    iosProductionUrlPreflight: summarizeRun(productionPreflight),
    iosPhysicalProductionSmoke: summarizeRun(physical)
  },
  blockers,
  deferred,
  notes: [
    "This command is read-only.",
    "It does not deploy nginx, write production business tables, or print token values.",
    "FINAL_CUTOVER_DEFER_PHYSICAL_DEVICE=1 records physical iPhone checks as deferred instead of blockers.",
    "FINAL_CUTOVER_USE_CANDIDATE_URL_FOR_IOS=1 treats /candidate-api/ as the iOS production URL candidate and does not require legacy /api/ 2xx.",
    "A non-empty blockers list means final cutover item 6 is not complete."
  ]
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}

async function runJson(command, args, envOverrides) {
  try {
    const result = await execFileAsync(command, args, {
      env: {
        ...process.env,
        ...envOverrides
      },
      maxBuffer: 10 * 1024 * 1024
    });
    return {
      ok: true,
      exitCode: 0,
      output: parseJsonOutput(result.stdout),
      stderrPreview: sanitize(result.stderr)
    };
  } catch (error) {
    return {
      ok: false,
      exitCode: error.code ?? null,
      output: parseJsonOutput(String(error.stdout ?? "")),
      stdoutPreview: sanitize(error.stdout),
      stderrPreview: sanitize(error.stderr),
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function candidateBlockers(run) {
  const output = run.output ?? {};
  const blockers = [];
  if (output.ok !== true) {
    blockers.push({
      id: "candidate-production-url",
      status: "blocked",
      reason: "candidate production URL smoke did not pass",
      evidence: {
        healthReachable: output.health?.reachable ?? null,
        quoteReachable: output.quote?.reachable ?? null,
        researchReachable: output.research?.reachable ?? null,
        quoteStatus: output.quote?.status ?? null,
        researchProfile: output.research?.profile ?? null
      }
    });
  }
  return blockers;
}

function productionPreflightBlockers(run) {
  const readiness = run.output?.readiness ?? {};
  const blockers = [];
  if (readiness.productionUrlReachable !== true) {
    blockers.push({
      id: "production-url-reachable",
      status: "blocked",
      reason: "production URL was not reachable from this host",
      evidence: readiness
    });
  }
  if (!useCandidateUrlForIosProduction && readiness.mobileApiAuthorized !== true) {
    blockers.push({
      id: "production-mobile-api-authorized",
      status: "blocked",
      reason: "production mobile quote/research API did not return authorized 2xx responses",
      evidence: {
        quoteStatus: run.output?.probes?.quote?.status ?? null,
        researchStatus: run.output?.probes?.research?.status ?? null
      }
    });
  }
  if (!deferPhysicalDevice && readiness.physicalDeviceOnline !== true) {
    blockers.push({
      id: "physical-device-online",
      status: "blocked",
      reason: "no online physical iPhone was reported by xctrace",
      evidence: run.output?.devices ?? null
    });
  }
  return blockers;
}

function physicalBlockers(run) {
  if (deferPhysicalDevice) {
    return [];
  }
  const output = run.output ?? {};
  if (output.ok === true) {
    return [];
  }
  return [{
    id: "ios-physical-production-smoke",
    status: "blocked",
    reason: `physical production smoke did not complete${output.phase ? `; phase=${output.phase}` : ""}`,
    evidence: {
      phase: output.phase ?? null,
      devices: output.devices ?? null,
      candidateSmokeOk: output.candidateSmoke?.ok ?? null
    }
  }];
}

function deferredPhysicalChecks(productionPreflight, physical) {
  return [{
    id: "physical-device-online",
    status: "deferred",
    reason: "user reported the physical iPhone cannot come online in this phase",
    evidence: {
      preflightDevices: productionPreflight.output?.devices ?? null,
      physicalSmokePhase: physical.output?.phase ?? null,
      physicalSmokeDevices: physical.output?.devices ?? null
    }
  }];
}

function summarizeRun(run) {
  return {
    ok: run.output?.ok === true,
    exitCode: run.exitCode,
    stderrPreview: run.stderrPreview || undefined
  };
}

function parseJsonOutput(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    return null;
  }
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

function sanitize(value) {
  return String(value ?? "").slice(0, 1000);
}
