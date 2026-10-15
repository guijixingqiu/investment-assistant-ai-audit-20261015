#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const mode = process.env.FACT_SOURCE_SWITCH_MODE ?? "client_candidate_api";
const legacyBaseUrl = process.env.FACT_SOURCE_LEGACY_BASE_URL ?? "https://audit-service.example.invalid:18443";
const candidateBaseUrl = process.env.FACT_SOURCE_CANDIDATE_BASE_URL ?? "https://audit-service.example.invalid:18443/candidate-api";
const symbol = process.env.FACT_SOURCE_SWITCH_SYMBOL ?? "HK.09926";
const live = process.env.FACT_SOURCE_SWITCH_LIVE_PROBES === "1";
const expectedAuthorization = "授权执行事实源切换前只读复核";
const authorization = process.env.FACT_SOURCE_SWITCH_AUTHORIZATION ?? "";
const allowedModes = new Set(["client_candidate_api", "limited_mobile_research_routes"]);

const checks = [];
const blockers = [];
const warnings = [];

check("switch mode is explicit and bounded", allowedModes.has(mode), {
  mode,
  allowedModes: [...allowedModes],
  forbiddenModes: ["blanket_legacy_api_proxy", "all_api_proxy", "dual_write"]
});
check("candidate base URL uses /candidate-api", isHttpUrl(candidateBaseUrl) && candidateBaseUrl.includes("/candidate-api"), {
  present: Boolean(candidateBaseUrl),
  valuePrinted: false
});
check("legacy base URL does not use /candidate-api", isHttpUrl(legacyBaseUrl) && !legacyBaseUrl.includes("/candidate-api"), {
  present: Boolean(legacyBaseUrl),
  valuePrinted: false
});

const boundary = await runJson("node", ["scripts/production-takeover-boundary-check.mjs"], {});
check("candidate production takeover boundary is static-clean", boundary.output?.ok === true, {
  ok: boundary.output?.ok === true,
  exitCode: boundary.exitCode
});

if (!live) {
  warnings.push({
    id: "dry-run-only",
    reason: "FACT_SOURCE_SWITCH_LIVE_PROBES is not set; no network probes were sent"
  });
}

if (live) {
  check("explicit live probe authorization", authorization === expectedAuthorization, {
    expectedAuthorization,
    provided: authorization.length > 0,
    valuePrinted: false
  });
}

let probes = null;
if (live && blockers.length === 0) {
  probes = await runLiveProbes();
  check("legacy research writes remain frozen", probes.legacyResearchEvent?.status === 423, probes.legacyResearchEvent);
  check("legacy decision writes remain frozen", probes.legacyDecisionCheck?.status === 423, probes.legacyDecisionCheck);
  check("candidate health is reachable", probes.candidateHealth?.status === 200, probes.candidateHealth);
  check("candidate research read is reachable", probes.candidateResearchRead?.status === 200, probes.candidateResearchRead);
  check("candidate write without token is rejected", probes.candidateWriteWithoutToken?.status === 401, probes.candidateWriteWithoutToken);
}

const result = {
  ok: blockers.length === 0,
  checkedAt: new Date().toISOString(),
  mode,
  live,
  symbol,
  urls: {
    legacyBaseUrl,
    candidateBaseUrl
  },
  allowedSwitch: describeAllowedSwitch(mode),
  forbiddenSwitches: [
    "Do not proxy the entire legacy /api tree to the candidate API.",
    "Do not dual-write trades, positions, decision checks, or reviews.",
    "Do not let AI or agents create true trades or true positions.",
    "Do not enable candidate writes without a fresh token lifecycle plan and revoke verification."
  ],
  boundary: {
    ok: boundary.output?.ok === true,
    allowedWrites: boundary.output?.productionTakeoverScope?.allowedWrites ?? null,
    explicitlyOutOfScopeWrites: boundary.output?.productionTakeoverScope?.explicitlyOutOfScopeWrites ?? null
  },
  probes,
  checks,
  blockers,
  warnings,
  goNoGo: blockers.length === 0
    ? "fact_source_switch_readiness_ready_for_bounded_switch_plan"
    : "no_go_clear_fact_source_switch_blockers",
  notes: [
    "This command does not deploy nginx, reload services, write production facts, or switch fact source.",
    "It only decides whether the next switch plan is bounded enough to continue.",
    "A passing result is not an approval to blanket-route /api to the candidate."
  ]
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}

function describeAllowedSwitch(selectedMode) {
  if (selectedMode === "client_candidate_api") {
    return "Clients may explicitly use the already deployed /candidate-api prefix for the candidate research/market surface; legacy /api remains separate and frozen for old research writes.";
  }
  return "Only specifically enumerated mobile research routes may be considered for proxying after a separate nginx route map and smoke plan are created.";
}

async function runLiveProbes() {
  const [market, code] = parseSymbol(symbol);
  return {
    legacyResearchEvent: await probe(legacyBaseUrl, "POST", "/api/research-events", {}),
    legacyDecisionCheck: await probe(legacyBaseUrl, "POST", "/api/decision-checks", {}),
    candidateHealth: await probe(candidateBaseUrl, "GET", "/health"),
    candidateResearchRead: await probe(candidateBaseUrl, "GET", `/api/mobile/research/profiles/${market}/${code}`),
    candidateWriteWithoutToken: await probe(candidateBaseUrl, "POST", `/api/mobile/research/profiles/${market}/${code}/evidence`, {})
  };
}

async function probe(baseUrl, method, path, body) {
  try {
    const response = await fetch(joinUrl(baseUrl, path), {
      method,
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8_000)
    });
    const text = await response.text();
    return {
      reachable: true,
      status: response.status,
      bodyPreview: text.slice(0, 120).replace(/\s+/g, " "),
      error: null
    };
  } catch (error) {
    return {
      reachable: false,
      status: null,
      bodyPreview: "",
      error: error instanceof Error ? error.message : String(error)
    };
  }
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
      stderrPreview: String(result.stderr ?? "").slice(0, 1000)
    };
  } catch (error) {
    return {
      ok: false,
      exitCode: error.code ?? null,
      output: parseJsonOutput(String(error.stdout ?? "")),
      stderrPreview: String(error.stderr ?? "").slice(0, 1000),
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function check(id, ok, evidence = {}) {
  const item = { id, ok, evidence };
  checks.push(item);
  if (!ok) {
    blockers.push({ id, evidence });
  }
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

function isHttpUrl(value) {
  return /^https?:\/\//.test(String(value ?? ""));
}

function joinUrl(baseUrl, path) {
  return `${String(baseUrl).replace(/\/+$/, "")}/${String(path).replace(/^\/+/, "")}`;
}

function parseSymbol(value) {
  const [market, code] = String(value).split(".");
  return [market || "HK", code || "09926"];
}
