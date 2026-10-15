import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { cp, link, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseArgs, promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { evaluateCandidateQuoteGate } from "./lib/candidate-quote-gate.mjs";

const DEFAULT_SYMBOL = "HK.00175";
const SNAPSHOT_SCHEMA_VERSION = "2026-08-12.fla35-readonly-counts.v3";
const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));
const IOS_PROJECT_ROOT = join(REPOSITORY_ROOT, "apps/ios/AnnualRingsGateA");
const IOS_PROJECT_SPEC = join(IOS_PROJECT_ROOT, "project.yml");
const XCODEGEN = "/opt/homebrew/bin/xcodegen";
const UI_TEST = "AnnualRingsGateAAppUITests/GateBResearchUITests/testFLA35FreshOpenDSearchMarketToExactResearchAcceptance";
const UI_TEST_NAME = "testFLA35FreshOpenDSearchMarketToExactResearchAcceptance";
const UI_TEST_CLASS = "GateBResearchUITests";
const UI_TEST_BUNDLE = "AnnualRingsGateAAppUITests";
const XCODEBUILD_TIMEOUT_MS = 20 * 60_000;
const HELP = `Usage: node scripts/fla35-readonly-acceptance.mjs [--evidence FILE] -- COMMAND [ARG...]

Required: API_BASE_URL, DATABASE_URL, STAGING_READONLY_AUTH_HEADER_NAME, STAGING_READONLY_AUTH_TOKEN.
Optional: FLA35_EXPECTED_SYMBOL (defaults to HK.00175).
Run npm run build first; missing dist contract validators fail closed.
The database snapshot wraps both the six fixed GET probes and COMMAND in one before/after run.
Only fixed HTTP GET requests are permitted by the probe. Tokens and response payloads are never printed.`;

export const COUNT_TABLES = Object.freeze([
  ["market", "stocks"],
  ["market", "market_quotes"],
  ["market", "data_refresh_runs"],
  ["market", "market_daily_snapshots"],
  ["market", "market_daily_bars"],
  ["market", "market_technical_snapshots"],
  ["market", "weinstein_technical_snapshots"],
  ["market", "market_daily_snapshot_states"],
  ["research_membership", "candidate_memberships"],
  ["research", "research_profiles"],
  ["research", "evidence_items"],
  ["research", "ai_update_suggestions"],
  ["research", "research_materials"],
  ["research", "research_events"],
  ["research", "research_fundamental_values"],
  ["research", "research_valuation_scenario_sets"],
  ["research", "research_context_snapshots"],
  ["task", "deep_research_tasks"],
  ["audit", "candidate_membership_audit_events"],
  ["audit", "research_write_audit_events"],
  ["audit", "research_fixture_seed_events"],
  ["audit", "audit_logs"],
  ["report", "research_evidence_packs"],
  ["report", "research_documents"],
  ["report", "research_document_pages"],
  ["report", "deep_research_reports"],
  ["report", "agent_reports"],
  ["monitor", "geely_sales_monitor_runs"],
  ["monitor", "gcl_pv_price_monitor_runs"],
  ["formal_decision", "ai_suggestion_decisions"],
  ["formal_decision", "deep_research_report_decisions"],
  ["formal_decision", "pre_trade_decision_checks"],
  ["formal_decision", "decision_checks"],
  ["review", "post_decision_reviews"],
  ["review", "reviews"],
  ["migration", "migrated_research_events"],
  ["migration", "legacy_research_events"],
  ["migration", "data_migration_runs"],
  ["migration", "pingan_import_batch_manifests"],
  ["asset", "portfolio_positions"],
  ["asset", "assets_alpha_snapshots"],
  ["asset", "positions"],
  ["asset", "position_snapshots"],
  ["asset", "broker_import_batches"],
  ["trade", "assets_alpha_trades"],
  ["trade", "trades"],
  ["trade", "broker_trades"],
  ["trade", "broker_raw_transactions"]
]);

export function acceptanceRequests(symbol = DEFAULT_SYMBOL) {
  const target = validateTargetSymbol(symbol);
  const code = target.slice(3);
  return Object.freeze({
    health: "/health",
    search: `/api/mobile/market/search?q=${code}`,
    quote: `/api/mobile/market/quotes/HK/${code}`,
    daily: `/api/mobile/market/daily-bars/HK/${code}`,
    environment: `/api/mobile/market/environment/HK/${code}`,
    membership: "/api/mobile/research/candidate-memberships"
  });
}

export async function requestJson(apiBaseUrl, requestPath, options = {}) {
  const method = options.method ?? "GET";
  if (method !== "GET") throw new Error("FLA-35 acceptance permits HTTP GET only");
  if (!Object.values(acceptanceRequests(options.symbol)).includes(requestPath)) {
    throw new Error("request path is outside the FLA-35 GET allowlist");
  }

  const response = await (options.fetchImpl ?? fetch)(apiUrl(apiBaseUrl, requestPath), {
    method: "GET",
    cache: "no-store",
    redirect: "error",
    headers: {
      accept: "application/json",
      ...(options.auth ? { [options.auth.headerName]: options.auth.token } : {})
    },
    signal: AbortSignal.timeout(options.timeoutMs ?? 35_000)
  }).catch(() => {
    throw new Error("FLA-35 GET failed closed");
  });
  if (!response.ok) throw new Error(`FLA-35 GET returned HTTP ${response.status}`);
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new Error("FLA-35 GET did not return JSON");
  }
  try {
    return await response.json();
  } catch {
    throw new Error("FLA-35 GET returned invalid JSON");
  }
}

export async function probeHttpAcceptance(apiBaseUrl, options = {}) {
  const symbol = validateTargetSymbol(options.symbol);
  const auth = validateReadAuth(options.readAuth);
  const validators = options.validators ?? await loadContractValidators();
  const requests = Object.entries(acceptanceRequests(symbol));
  const settled = [];
  for (const [name, requestPath] of requests) {
    try {
      settled.push({ status: "fulfilled", value: [name, await requestJson(apiBaseUrl, requestPath, {
        ...options,
        auth: name === "membership" ? auth : null
      })] });
    } catch (reason) {
      settled.push({ status: "rejected", reason });
    }
  }
  const rejectedIndex = settled.findIndex((result) => result.status === "rejected");
  if (rejectedIndex >= 0) {
    throw taggedFailure(new Error("FLA-35 GET set failed closed"), requests[rejectedIndex][0],
      `${requests[rejectedIndex][0].toUpperCase()}_GET_FAILED`);
  }
  const entries = settled.map((result) => result.value);
  const payloads = Object.fromEntries(entries);
  const environment = validateStage("environment", () => validateEnvironment(payloads.environment, validators, symbol));
  return {
    health: validateStage("health", () => validateHealth(payloads.health)),
    search: validateStage("search", () => validateSearch(payloads.search, validators, symbol)),
    quote: validateStage("quote", () => validateQuote(payloads.quote, validators, environment, options.now ?? new Date(), symbol)),
    daily: validateStage("daily", () => validateDaily(payloads.daily, validators, symbol)),
    environment,
    membership: validateStage("membership", () => validateMembership(payloads.membership, validators, symbol))
  };
}

export async function loadContractValidators() {
  try {
    const [market, daily, environment, membership] = await Promise.all([
      import("../dist/packages/contracts/src/market.js"),
      import("../dist/packages/contracts/src/marketDaily.js"),
      import("../dist/packages/contracts/src/marketEnvironment.js"),
      import("../dist/packages/contracts/src/candidateMembership.js")
    ]);
    return {
      validateMarketSearchEnvelope: market.validateMarketSearchEnvelope,
      validateMarketQuoteEnvelope: market.validateMarketQuoteEnvelope,
      validateDailyTechnicalEnvelope: daily.validateDailyTechnicalEnvelope,
      validateMarketEnvironmentEnvelope: environment.validateMarketEnvironmentEnvelope,
      validateCandidateMembershipEnvelope: membership.validateCandidateMembershipEnvelope
    };
  } catch {
    throw new Error("compiled contract validators are unavailable; run npm run build before FLA-35 acceptance");
  }
}

export async function captureDatabaseCounts(databaseUrl, binding) {
  assertLoopbackDatabaseUrl(databaseUrl);
  validateSnapshotBinding(binding);
  const symbol = validateTargetSymbol(binding.symbol);
  let Client;
  try {
    ({ Client } = await import("pg"));
  } catch {
    throw new Error("existing pg dependency is unavailable");
  }
  const client = new Client({
    connectionString: databaseUrl,
    application_name: "fla35-readonly-acceptance"
  });
  try {
    await client.connect();
    await client.query("begin transaction isolation level repeatable read read only");
    await client.query("set local statement_timeout = '5s'");
    await client.query("set local lock_timeout = '1s'");
    const captured = await client.query(`select current_database() as current_database,
                                                current_user as current_user,
                                                transaction_timestamp() as captured_at`);
    const tables = {};
    for (const [category, table] of COUNT_TABLES) {
      const found = await client.query("select to_regclass($1)::text as relation", [`public.${table}`]);
      if (!found.rows[0]?.relation) {
        tables[table] = { category, status: "absent" };
        continue;
      }
      const measured = (await client.query(`
        select count(*)::text as count,
               md5(coalesce(string_agg(row_hash, ',' order by row_hash), '')) as content_hash
          from (
            select md5(row_to_json(source_row)::text) as row_hash
              from public.${quoteIdent(table)} source_row
          ) hashed_rows
      `)).rows[0];
      tables[table] = {
        category,
        status: "present",
        count: String(measured?.count),
        contentHash: measured?.content_hash
      };
    }
    const targetMembershipResult = await client.query(`
      select id::text as id, actor_type, actor_id, version, symbol, state, updated_at
        from public.candidate_memberships
       where id = $1 and version = $2 and symbol = $3 and state <> 'archived'
    `, [binding.expectedMembership.id, binding.expectedMembership.version, symbol]);
    expect(targetMembershipResult.rows.length === 1, "exact expected membership is not present in the snapshot database");
    const targetMembership = targetMembershipResult.rows[0];
    await client.query("commit");
    const identity = captured.rows[0];
    const snapshot = {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      runId: binding.runId,
      gitHead: binding.gitHead,
      phase: binding.phase,
      current_database: identity?.current_database,
      current_user: identity?.current_user,
      captured_at: new Date(identity?.captured_at).toISOString(),
      isolation: "repeatable_read_read_only",
      targetMembership: {
        id: targetMembership.id,
        actorType: targetMembership.actor_type,
        actorId: targetMembership.actor_id,
        version: targetMembership.version,
        symbol: targetMembership.symbol,
        state: targetMembership.state,
        updatedAt: new Date(targetMembership.updated_at).toISOString()
      },
      tables
    };
    validateCountSnapshot(snapshot);
    return snapshot;
  } catch {
    try { await client.query("rollback"); } catch { /* preserve the original failure */ }
    throw new Error("database count snapshot failed closed");
  } finally {
    await client.end().catch(() => {});
  }
}

export function compareCountSnapshots(before, after) {
  validateCountSnapshot(before);
  validateCountSnapshot(after);
  const tables = {};
  const identity = {
    sameDatabase: before.current_database === after.current_database,
    sameUser: before.current_user === after.current_user,
    sameRun: before.runId === after.runId,
    sameGitHead: before.gitHead === after.gitHead,
    exactPhases: before.phase === "before" && after.phase === "after",
    sameTargetMembership: sameMembershipIdentity(before.targetMembership, after.targetMembership),
    capturedAtOrdered: Date.parse(before.captured_at) <= Date.parse(after.captured_at)
  };
  let ok = Object.values(identity).every(Boolean);
  for (const [, table] of COUNT_TABLES) {
    const left = before.tables[table];
    const right = after.tables[table];
    if (left.status === "absent" && right.status === "absent") {
      tables[table] = { category: left.category, before: "absent", after: "absent", delta: "0" };
      continue;
    }
    if (left.status !== "present" || right.status !== "present") {
      ok = false;
      tables[table] = { category: left.category, before: left.status, after: right.status, delta: null };
      continue;
    }
    const delta = BigInt(right.count) - BigInt(left.count);
    const contentMatches = left.contentHash === right.contentHash;
    if (delta !== 0n || !contentMatches) ok = false;
    tables[table] = {
      category: left.category,
      before: left.count,
      after: right.count,
      delta: String(delta),
      contentMatches
    };
  }
  return { ok, identity, tables };
}

export async function runReadOnlyAcceptance(apiBaseUrl, databaseUrl, options) {
  expect(nonEmpty(databaseUrl), "DATABASE_URL is required for zero-write acceptance");
  expect(typeof options?.runJourney === "function", "an exact UI journey command is required");
  const settings = options ?? {};
  const symbol = validateTargetSymbol(settings.symbol);
  const runId = settings.runId ?? randomUUID();
  const expectedMembership = validateExpectedMembership(settings.expectedMembership);
  const gitIdentity = settings.currentGitIdentity ?? currentGitIdentity;
  const startGit = await gitIdentity();
  expect(startGit.clean, "FLA-35 acceptance requires a clean Git worktree");
  const head = startGit.head;
  const capture = settings.captureCounts ?? captureDatabaseCounts;
  const before = await capture(databaseUrl, { runId, gitHead: head, phase: "before", expectedMembership, symbol });
  let http = null;
  let journeyError = null;
  let failureStage = null;
  let failureCode = null;
  let journeyStarted = false;
  let journeyResult = null;
  try {
    http = await (settings.probe ?? probeHttpAcceptance)(apiBaseUrl, settings);
    journeyStarted = true;
    journeyResult = await settings.runJourney() ?? null;
  } catch (error) {
    journeyError = "HTTP acceptance or UI journey failed closed";
    failureStage = typeof error?.failureStage === "string" ? error.failureStage : journeyStarted ? "journey" : "http";
    failureCode = typeof error?.failureCode === "string" ? error.failureCode
      : journeyStarted ? "UI_JOURNEY_FAILED" : "HTTP_ACCEPTANCE_FAILED";
  }
  const after = await capture(databaseUrl, { runId, gitHead: head, phase: "after", expectedMembership, symbol });
  const endGit = await gitIdentity().catch(() => ({ head: null, clean: false }));
  const git = { startHead: head, endHead: endGit.head, cleanExact: endGit.clean && endGit.head === head };
  const comparison = compareCountSnapshots(before, after);
  const apiDatabaseBound = sameMembershipIdentity(http?.membership, before.targetMembership)
    && sameMembershipIdentity(http?.membership, after.targetMembership);
  return {
    ok: journeyError === null && comparison.ok && git.cleanExact && apiDatabaseBound,
    mode: "read-only",
    gitHead: head,
    runId,
    git,
    symbol,
    requests: Object.values(acceptanceRequests(symbol)).map((path) => `GET ${path}`),
    http,
    journey: {
      started: journeyStarted,
      passed: journeyStarted && journeyError === null,
      result: journeyResult,
      error: journeyError,
      failureStage,
      failureCode
    },
    database: { before, after, comparison, apiDatabaseBound }
  };
}

export async function withReadOnlyUiProxy(apiBaseUrl, run) {
  expect(typeof run === "function", "a UI journey callback is required");
  const upstreamBase = new URL(normalizeBaseUrl(apiBaseUrl));
  const requests = [];
  const server = createServer((incoming, outgoing) => {
    const method = incoming.method ?? "UNKNOWN";
    const requestPath = incoming.url ?? "/";
    requests.push(method);
    if (method !== "GET") {
      incoming.resume();
      outgoing.writeHead(405, { "content-type": "application/json" });
      outgoing.end('{"ok":false,"error":"FLA35_READ_ONLY"}');
      return;
    }
    let upstream;
    try {
      upstream = apiUrl(upstreamBase.toString(), requestPath);
      expect(upstream.origin === upstreamBase.origin, "UI request escaped the loopback API");
    } catch {
      outgoing.writeHead(400, { "content-type": "application/json" });
      outgoing.end('{"ok":false,"error":"FLA35_INVALID_URL"}');
      return;
    }
    const headers = { ...incoming.headers, host: upstream.host };
    delete headers["content-length"];
    delete headers["transfer-encoding"];
    const forwarded = httpRequest(upstream, { method: "GET", headers }, (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    });
    forwarded.once("error", () => {
      if (!outgoing.headersSent) outgoing.writeHead(502, { "content-type": "application/json" });
      outgoing.end('{"ok":false,"error":"FLA35_UPSTREAM_UNAVAILABLE"}');
    });
    incoming.once("aborted", () => forwarded.destroy());
    forwarded.end();
  });
  for (const event of ["connect", "upgrade"]) {
    server.on(event, (_request, socket) => {
      requests.push(event.toUpperCase());
      socket.end("HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n");
    });
  }
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    expect(record(address) && typeof address.port === "number", "read-only UI proxy did not start");
    const result = await run(`http://127.0.0.1:${address.port}`);
    expect(requests.every((method) => method === "GET"), "UI journey attempted a non-GET request");
    return { result, requests };
  } finally {
    await new Promise((done) => {
      server.close(done);
      server.closeAllConnections?.();
    });
  }
}

export async function resolveEvidencePath(value) {
  expect(nonEmpty(value), "FLA-35 evidence path is required");
  const requested = resolve(value);
  const [repository, parent] = await Promise.all([realpath(REPOSITORY_ROOT), realpath(dirname(requested))]);
  const evidencePath = join(parent, basename(requested));
  const relation = relative(repository, evidencePath);
  const insideGitRepository = await execFileAsync("/usr/bin/git", [
    "-C", parent, "rev-parse", "--absolute-git-dir"
  ]).then(() => true, () => false);
  expect(basename(requested).length > 0
    && (relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation))
    && !insideGitRepository,
  "FLA-35 evidence must be written outside every Git repository");
  return evidencePath;
}

export async function writeAcceptanceEvidence(evidencePath, result, options = {}) {
  const pendingPath = `${evidencePath}.pending-${randomUUID()}`;
  const writer = options.write ?? writeFile;
  const remove = options.remove ?? rm;
  try {
    await writer(pendingPath, `${JSON.stringify({ ...result, ok: false, evidenceState: "pending-final-git-check" }, null, 2)}\n`, {
      encoding: "utf8", flag: "wx", mode: 0o600
    });
  } catch {
    throw new Error("FLA-35 evidence file was not written");
  }
  const git = await (options.currentGitIdentity ?? currentGitIdentity)()
    .catch(() => ({ head: null, clean: false }));
  if (!git.clean || git.head !== result.gitHead) {
    await remove(pendingPath, { force: true }).catch(() => {});
    throw new Error("Git identity changed while writing FLA-35 evidence");
  }
  try {
    await writer(pendingPath, `${JSON.stringify({ ...result, evidenceState: "verified" }, null, 2)}\n`, {
      encoding: "utf8", flag: "w", mode: 0o600
    });
    await (options.publish ?? link)(pendingPath, evidencePath);
  } catch {
    await remove(pendingPath, { force: true }).catch(() => {});
    throw new Error("FLA-35 evidence file was not written");
  }
  await remove(pendingPath, { force: true }).catch(() => {});
}

function validateHealth(value) {
  expect(record(value) && value.ok === true, "health is unavailable");
  expect(value.service === "annual-rings-api" && value.gate === "A", "health service identity is wrong");
  expect(value.marketProvider === "futu", "health is not bound to the Futu/OpenD provider");
  return { ok: true, service: value.service, gate: value.gate, marketProvider: value.marketProvider };
}

function validateSearch(value, validators, symbol) {
  const code = symbol.slice(3);
  contract(validators.validateMarketSearchEnvelope(value), "search");
  expect(value.status === "available" && value.query === code, "search is unavailable or query identity drifted");
  expect(value.scope === "futu_opend_hk_stocks" && record(value.source)
    && value.source.provider === "futu_opend" && value.source.quoteDataOnly === true
    && instant(value.source.fetchedAt), "search did not use Futu/OpenD identity");
  const symbols = value.results.map((item) => item.symbol);
  expect(symbols.includes(symbol), `search did not return exact ${symbol} identity`);
  return { status: value.status, scope: value.scope, provider: value.source.provider, resultCount: symbols.length, matchedSymbol: symbol };
}

function validateQuote(value, validators, environment, now, symbol) {
  const code = symbol.slice(3);
  contract(validators.validateMarketQuoteEnvelope(value, now), "quote");
  const gate = evaluateCandidateQuoteGate(value, {
    now,
    marketClosed: ["CLOSED", "PRE_OPEN"].includes(environment.marketState) ? "1" : "0",
    allowMarketClosedStale: "1"
  });
  if (!gate.ok) {
    throw taggedFailure(
      new Error("quote is not current for the reported market state"),
      "quote",
      "QUOTE_NOT_CURRENT_FOR_MARKET_STATE"
    );
  }
  expect(value.requestedSymbol === symbol, "quote is stale, unavailable, or symbol-drifted");
  expect(value.source.provider === "futu" && value.source.providerStatus === value.status,
    "quote is not exact Futu/OpenD evidence");
  expect(record(value.data) && value.data.market === "HK" && value.data.code === code
    && value.data.symbol === symbol && value.data.currency === "HKD", "quote data identity is invalid");
  return {
    status: gate.mode === "market_closed_stale" ? "stale" : value.status,
    providerStatus: value.status,
    gateMode: gate.mode,
    provider: value.source.provider,
    symbol: value.data.symbol,
    asOf: value.asOf,
    fetchedAt: value.source.fetchedAt
  };
}

function validateDaily(value, validators, symbol) {
  const code = symbol.slice(3);
  contract(validators.validateDailyTechnicalEnvelope(value), "daily evidence");
  expect(record(value) && value.completeness === "complete" && value.usableForRequestedCutoff === true,
    "daily evidence is incomplete or unusable");
  const daily = value.dailyBars;
  const technical = value.technical;
  expect(daily.status === "available" && daily.request.market === "HK" && daily.request.code === code
    && daily.request.symbol === symbol && daily.request.timeframe === "1d"
    && daily.request.completedSessionsOnly === true, "daily request identity is invalid");
  expect(daily.source.provider === "futu_history_kline" && daily.source.endpoint === "request_history_kline",
  "daily evidence is not exact Futu/OpenD history evidence");
  const snapshot = daily.snapshot;
  expect(technical.status === "available" && technical.inputSnapshotSha === snapshot.snapshotSha,
    "technical result integrity identity is invalid");
  return {
    completeness: value.completeness,
    provider: daily.source.provider,
    symbol: daily.request.symbol,
    cutoff: daily.request.cutoff,
    snapshotSha: snapshot.snapshotSha,
    resultHash: technical.resultHash
  };
}

function validateEnvironment(value, validators, symbol) {
  contract(validators.validateMarketEnvironmentEnvelope(value), "environment");
  expect(value.status === "available" && value.requestedSymbol === symbol,
    "environment is unavailable or requested symbol is wrong");
  expect(value.source.provider === "futu_opend" && value.source.endpoint === "market-environment"
    && value.source.quoteDataOnly === true, "environment source identity is invalid");
  const data = value.data;
  expect(data.market === "HK" && data.selectedSymbol === symbol, "environment stock identity is invalid");
  return {
    status: value.status,
    provider: value.source.provider,
    symbol: data.selectedSymbol,
    marketState: data.marketState,
    asOf: value.asOf
  };
}

function validateMembership(value, validators, symbol) {
  const code = symbol.slice(3);
  contract(validators.validateCandidateMembershipEnvelope(value), "candidate memberships");
  expect(value.status === "available" && value.includeArchived === false,
    "candidate memberships are unavailable or include archived rows");
  const matches = value.memberships.filter((membership) => membership.symbol === symbol && membership.state !== "archived");
  expect(matches.length === 1, `${symbol} must have exactly one non-archived membership`);
  const membership = matches[0];
  expect(/^[1-9]\d*$/.test(membership.id) && Number.isSafeInteger(membership.version) && membership.version > 0
    && membership.market === "HK" && membership.code === code && membership.symbol === symbol
    && membership.archivedAt === null, `${symbol} membership identity is invalid`);
  return {
    id: membership.id,
    actorId: membership.actorId,
    version: membership.version,
    symbol: membership.symbol,
    state: membership.state,
    updatedAt: membership.updatedAt
  };
}

function validateCountSnapshot(value) {
  expect(record(value) && value.schemaVersion === SNAPSHOT_SCHEMA_VERSION
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.runId)
    && /^[0-9a-f]{40}$/.test(value.gitHead) && ["before", "after"].includes(value.phase)
    && nonEmpty(value.current_database) && nonEmpty(value.current_user)
    && value.isolation === "repeatable_read_read_only" && instant(value.captured_at)
    && validSnapshotMembership(value.targetMembership) && record(value.tables),
  "database count snapshot identity is invalid");
  expect(Object.keys(value.tables).length === COUNT_TABLES.length, "database count snapshot table set is incomplete");
  for (const [category, table] of COUNT_TABLES) {
    const entry = value.tables[table];
    expect(record(entry) && entry.category === category && (entry.status === "absent"
      || entry.status === "present" && typeof entry.count === "string" && /^\d+$/.test(entry.count)
        && typeof entry.contentHash === "string" && /^[0-9a-f]{32}$/.test(entry.contentHash)),
    `database count snapshot entry is invalid: ${table}`);
  }
}

function validateSnapshotBinding(value) {
  expect(record(value)
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.runId)
    && /^[0-9a-f]{40}$/.test(value.gitHead)
    && ["before", "after"].includes(value.phase) && validTargetSymbol(value.symbol)
    && validExpectedMembership(value.expectedMembership), "database snapshot run binding is invalid");
}

function apiUrl(value, requestPath) {
  let base;
  try { base = new URL(value); } catch { throw new Error("API_BASE_URL must be an explicit loopback HTTP URL"); }
  expect(base.protocol === "http:" && loopback(base.hostname) && !base.username && !base.password
    && !base.search && !base.hash, "API_BASE_URL must be an explicit loopback HTTP URL without credentials");
  const request = new URL(requestPath, "http://fla35.invalid");
  base.pathname = `${base.pathname.replace(/\/+$/, "")}${request.pathname}`;
  base.search = request.search;
  return base;
}

function assertLoopbackDatabaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("DATABASE_URL must use a task-owned loopback forward"); }
  expect(["postgres:", "postgresql:"].includes(url.protocol) && loopback(url.hostname),
    "DATABASE_URL must use a task-owned loopback forward");
}

function readAuthFromEnv(env) {
  const auth = validateReadAuth({
    headerName: env.STAGING_READONLY_AUTH_HEADER_NAME,
    token: env.STAGING_READONLY_AUTH_TOKEN
  });
  const writeTokens = [env.WRITE_API_TOKEN, env.INTERNAL_API_TOKEN].filter(Boolean);
  expect(!writeTokens.includes(auth.token), "read token must be distinct from configured write tokens");
  return auth;
}

function validateReadAuth(value) {
  expect(record(value) && nonEmpty(value.headerName) && nonEmpty(value.token),
    "STAGING_READONLY_AUTH_HEADER_NAME and STAGING_READONLY_AUTH_TOKEN are required");
  const headerName = value.headerName.trim();
  expect(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(headerName), "read-auth header name is invalid");
  return { headerName, token: value.token };
}

function contract(result, label) {
  expect(result?.ok === true, `${label} failed shared contract validation`);
}

async function currentGitIdentity() {
  try {
    const revision = await execFileAsync("/usr/bin/git", ["rev-parse", "HEAD"], { cwd: REPOSITORY_ROOT });
    const status = await execFileAsync("/usr/bin/git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: REPOSITORY_ROOT });
    const head = revision.stdout.trim();
    expect(/^[0-9a-f]{40}$/.test(head), "current Git HEAD is invalid");
    return { head, clean: status.stdout.length === 0 };
  } catch {
    throw new Error("current Git identity could not be verified");
  }
}

export function validateJourneyCommand(argv) {
  expect(Array.isArray(argv) && argv.length > 0, "an exact UI journey command is required");
  expect(argv[0] === "/usr/bin/xcodebuild", "COMMAND must invoke the system xcodebuild directly");
  const args = argv.slice(1);
  const actions = args.filter((arg) => arg === "test" || arg === "test-without-building");
  expect(actions.length === 1 && actions[0] === "test", "COMMAND must freshly build and execute one XCTest action");
  expect(!args.some((arg) => arg === "-skip-testing" || arg.startsWith("-skip-testing:")),
    "COMMAND must not skip tests");
  const selectedTests = args.filter((arg) => arg.startsWith("-only-testing:"));
  expect(selectedTests.length === 1 && selectedTests[0] === `-only-testing:${UI_TEST}`,
    "COMMAND must select only the exact FLA-35 live UI acceptance test");
  const destinations = valuesForFlag(args, "-destination");
  expect(destinations.length === 1
    && /^platform=iOS Simulator,id=[0-9A-F-]{36}$/i.test(destinations[0]),
  "COMMAND must target one explicit iOS Simulator UDID");
  const schemes = valuesForFlag(args, "-scheme");
  expect(schemes.length === 1 && schemes[0] === "AnnualRingsGateAAppSmoke",
    "COMMAND must use the FLA-35 UI-test scheme");
  expect(valuesForFlag(args, "-project").length === 0
    && valuesForFlag(args, "-workspace").length === 0
    && valuesForFlag(args, "-derivedDataPath").length === 0
    && valuesForFlag(args, "-resultBundlePath").length === 0,
  "COMMAND must leave build-artifact ownership to the acceptance wrapper");
  expect(args.length === 6, "COMMAND accepts no extra xcodebuild arguments");
}

function validateJourneyEnvironment(env, readAuth) {
  expect(env.FLA35_IOS_LIVE_ACCEPTANCE === "1", "FLA35_IOS_LIVE_ACCEPTANCE=1 is required");
  expect(normalizeBaseUrl(env.ANNUAL_RINGS_GATE_A_BASE_URL) === normalizeBaseUrl(env.API_BASE_URL),
    "the UI journey and HTTP probe must use the same loopback API");
  expect(env.ANNUAL_RINGS_UI_AUTH_TOKEN === readAuth.token,
    "the UI journey must use the same read-only token as the HTTP probe");
  expect(env.ANNUAL_RINGS_UI_AUTH_HEADER?.toLowerCase() === readAuth.headerName.toLowerCase(),
    "the UI journey must use the same read-only header as the HTTP probe");
  expect(/^[1-9]\d*$/.test(env.FLA35_EXPECTED_MEMBERSHIP_ID ?? "")
    && /^[1-9]\d*$/.test(env.FLA35_EXPECTED_MEMBERSHIP_VERSION ?? ""),
  "exact expected membership id and version are required");
  validateTargetSymbol(env.FLA35_EXPECTED_SYMBOL);
  if (env.HK_CONNECT_MULTI_STOCK_COMPARISON === "1") {
    validateTargetSymbol(env.HK_CONNECT_COMPARE_SYMBOL);
    expect(env.HK_CONNECT_COMPARE_SYMBOL !== env.FLA35_EXPECTED_SYMBOL,
      "comparison symbol must differ from the current symbol");
    expect(/^[1-9]\d*$/.test(env.HK_CONNECT_COMPARE_MEMBERSHIP_ID ?? "")
      && /^[1-9]\d*$/.test(env.HK_CONNECT_COMPARE_MEMBERSHIP_VERSION ?? ""),
    "exact comparison membership id and version are required");
  }
}

function normalizeBaseUrl(value) {
  const url = apiUrl(value, "/");
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

async function runJourneyCommand(argv, apiBaseUrl) {
  validateJourneyCommand(argv);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "fla35-xcode-"));
  const resultBundle = join(temporaryDirectory, "acceptance.xcresult");
  const derivedData = join(temporaryDirectory, "DerivedData");
  const generatedProjectDirectory = join(temporaryDirectory, "Project");
  const generatedProject = join(generatedProjectDirectory, "AnnualRingsGateAApp.xcodeproj");
  try {
    await mkdir(generatedProjectDirectory);
    await Promise.all([
      cp(join(IOS_PROJECT_ROOT, "Assets.xcassets"), join(generatedProjectDirectory, "Assets.xcassets"), { recursive: true }),
      cp(join(IOS_PROJECT_ROOT, "Config"), join(generatedProjectDirectory, "Config"), { recursive: true })
    ]);
    await execFileAsync(XCODEGEN, [
      "--quiet", "--no-env", "--spec", IOS_PROJECT_SPEC,
      "--project-root", IOS_PROJECT_ROOT, "--project", generatedProjectDirectory
    ], { cwd: REPOSITORY_ROOT, env: toolEnvironment(process.env) });
    const proxied = await withReadOnlyUiProxy(apiBaseUrl, async (proxyBaseUrl) => {
      await installJourneyTestEnvironment(generatedProject, journeyTestEnvironment(process.env, proxyBaseUrl));
      await runXcodebuild([
        argv[0], "-quiet", "-project", generatedProject, ...argv.slice(1),
        "-derivedDataPath", derivedData,
        "-resultBundlePath", resultBundle
      ], proxyBaseUrl);
      const { stdout } = await execFileAsync("/usr/bin/xcrun", [
        "xcresulttool", "get", "test-results", "tests", "--path", resultBundle, "--compact"
      ], { cwd: REPOSITORY_ROOT, env: toolEnvironment(process.env), maxBuffer: 16 * 1024 * 1024 });
      return validateXcresultTests(JSON.parse(stdout));
    });
    return { ...proxied.result, requests: proxied.requests };
  } catch {
    try {
      const { stdout } = await execFileAsync("/usr/bin/xcrun", [
        "xcresulttool", "get", "test-results", "summary", "--path", resultBundle, "--compact"
      ], { cwd: REPOSITORY_ROOT, env: toolEnvironment(process.env), maxBuffer: 16 * 1024 * 1024 });
      process.stderr.write(`${stdout}\n`);
      const details = await execFileAsync("/usr/bin/xcrun", [
        "xcresulttool", "get", "test-results", "test-details", "--path", resultBundle, "--compact",
        "--test-id", `${UI_TEST_CLASS}/${UI_TEST_NAME}()`
      ], { cwd: REPOSITORY_ROOT, env: toolEnvironment(process.env), maxBuffer: 16 * 1024 * 1024 });
      process.stderr.write(`${details.stdout}\n`);
      const activities = JSON.parse((await execFileAsync("/usr/bin/xcrun", [
        "xcresulttool", "get", "test-results", "activities", "--path", resultBundle, "--compact",
        "--test-id", `${UI_TEST_CLASS}/${UI_TEST_NAME}()`
      ], { cwd: REPOSITORY_ROOT, env: toolEnvironment(process.env), maxBuffer: 64 * 1024 * 1024 })).stdout);
      const failures = [];
      const visit = (node, path = []) => {
        const next = [...path, node.title];
        if (node.isAssociatedWithFailure) failures.push(next);
        node.childActivities?.forEach((child) => visit(child, next));
      };
      activities.testRuns.activities.forEach((activity) => visit(activity));
      process.stderr.write(`${JSON.stringify({ failureActivities: failures })}\n`);
    } catch {}
    throw new Error("FLA-35 UI journey failed closed");
  } finally {
    if (process.env.FLA35_PRESERVE_XCRESULT === "1") process.stderr.write(`FLA35_XCRESULT=${resultBundle}\n`);
    else await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function runXcodebuild(argv, apiBaseUrl) {
  return new Promise((resolvePromise, rejectPromise) => {
    let finished = false;
    let timedOut = false;
    let forceKill = null;
    const child = spawn(argv[0], argv.slice(1), {
      cwd: REPOSITORY_ROOT,
      env: journeyEnvironment(process.env, apiBaseUrl),
      stdio: ["ignore", process.stderr, process.stderr],
      shell: false,
      detached: true
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      signalProcessGroup(child.pid, "SIGTERM");
      forceKill = setTimeout(() => {
        signalProcessGroup(child.pid, "SIGKILL");
        settle(new Error("FLA-35 UI journey timed out"));
      }, 5_000);
    }, XCODEBUILD_TIMEOUT_MS);
    const settle = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      if (error) rejectPromise(error);
      else resolvePromise();
    };
    child.once("error", () => settle(new Error("FLA-35 UI journey could not start")));
    child.once("exit", (code, signal) => {
      if (timedOut) return;
      if (code === 0 && signal === null) settle();
      else settle(new Error("FLA-35 UI journey failed"));
    });
  });
}

export function journeyEnvironment(env, apiBaseUrl = env.ANNUAL_RINGS_GATE_A_BASE_URL) {
  return {
    ...selectEnvironment(env, [
      "PATH", "HOME", "TMPDIR", "DEVELOPER_DIR", "LANG", "LC_ALL", "USER", "LOGNAME", "SHELL"
    ]),
    ...journeyTestEnvironment(env, apiBaseUrl)
  };
}

export function journeyTestEnvironment(env, apiBaseUrl = env.ANNUAL_RINGS_GATE_A_BASE_URL) {
  return {
    ...selectEnvironment(env, [
      "FLA35_IOS_LIVE_ACCEPTANCE", "ANNUAL_RINGS_UI_AUTH_HEADER", "ANNUAL_RINGS_UI_AUTH_TOKEN",
      "FLA35_EXPECTED_MEMBERSHIP_ID", "FLA35_EXPECTED_MEMBERSHIP_VERSION", "FLA35_EXPECTED_SYMBOL",
      "HK_CONNECT_MULTI_STOCK_COMPARISON", "HK_CONNECT_COMPARE_SYMBOL",
      "HK_CONNECT_COMPARE_MEMBERSHIP_ID", "HK_CONNECT_COMPARE_MEMBERSHIP_VERSION",
      "HK_CONNECT_QUANT_PORTFOLIO"
    ]),
    ANNUAL_RINGS_GATE_A_BASE_URL: apiBaseUrl
  };
}

export function journeySchemeEnvironmentBlock(env) {
  return `      <EnvironmentVariables>\n${Object.entries(env).map(([key, value]) => `         <EnvironmentVariable\n            key = "${xmlAttribute(key)}"\n            value = "${xmlAttribute(value)}"\n            isEnabled = "YES">\n         </EnvironmentVariable>`).join("\n")}\n      </EnvironmentVariables>`;
}

async function installJourneyTestEnvironment(project, env) {
  const scheme = join(project, "xcshareddata/xcschemes/AnnualRingsGateAAppSmoke.xcscheme");
  const source = await readFile(scheme, "utf8");
  await writeFile(scheme, journeySchemeWithEnvironment(source, env), "utf8");
}

export function journeySchemeWithEnvironment(source, env) {
  const commandMarker = "      <CommandLineArguments>\n      </CommandLineArguments>";
  const inheritedMarker = '      shouldUseLaunchSchemeArgsEnv = "YES"\n      onlyGenerateCoverageForSpecifiedTargets';
  expect(source.split(commandMarker).length === 2 && source.split(inheritedMarker).length === 2
    && !source.includes("<EnvironmentVariables>"), "generated FLA-35 test scheme is not exact");
  return source.replace(inheritedMarker, inheritedMarker.replace('"YES"', '"NO"'))
    .replace(commandMarker, `${commandMarker}\n${journeySchemeEnvironmentBlock(env)}`);
}

function toolEnvironment(env) {
  return selectEnvironment(env, ["PATH", "HOME", "TMPDIR", "DEVELOPER_DIR", "LANG", "LC_ALL", "USER", "LOGNAME", "SHELL"]);
}

function selectEnvironment(env, names) {
  return Object.fromEntries(names.flatMap((name) => env[name] === undefined ? [] : [[name, env[name]]]));
}

function xmlAttribute(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&apos;");
}

export function validateXcresultTests(value) {
  expect(record(value) && Array.isArray(value.testNodes), "xcresult test report is invalid");
  const matches = [];
  const visit = (nodes, ancestors = []) => {
    for (const node of nodes ?? []) {
      const names = [...ancestors, node?.name].filter(nonEmpty);
      const normalizedName = node?.name?.replace(/\(\)$/, "");
      const normalizedIdentifier = node?.nodeIdentifier?.replace(/\(\)$/, "");
      const bundleBound = names.some((name) => name === UI_TEST_BUNDLE || name === `${UI_TEST_BUNDLE}.xctest`);
      const classBound = names.includes(UI_TEST_CLASS);
      const identifierBound = normalizedIdentifier === UI_TEST || normalizedIdentifier?.endsWith(`/${UI_TEST}`);
      if (node?.nodeType === "Test Case" && normalizedName === UI_TEST_NAME
        && (identifierBound || bundleBound && classBound)) matches.push(node);
      visit(node?.children, names);
    }
  };
  visit(value.testNodes);
  expect(matches.length === 1 && matches[0].result === "Passed",
    "the exact FLA-35 UI acceptance test did not execute and pass once");
  return {
    test: UI_TEST,
    result: matches[0].result,
    durationInSeconds: matches[0].durationInSeconds ?? null
  };
}

function valuesForFlag(args, flag) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

function validateExpectedMembership(value) {
  expect(validExpectedMembership(value), "exact expected membership id and version are required");
  return { id: value.id, version: value.version };
}

function validExpectedMembership(value) {
  return record(value) && typeof value.id === "string" && /^[1-9]\d*$/.test(value.id)
    && Number.isSafeInteger(value.version) && value.version > 0;
}

function validSnapshotMembership(value) {
  return record(value) && /^[1-9]\d*$/.test(value.id) && ["user", "system"].includes(value.actorType)
    && nonEmpty(value.actorId) && Number.isSafeInteger(value.version) && value.version > 0
    && validTargetSymbol(value.symbol) && ["tracked", "paused"].includes(value.state) && instant(value.updatedAt);
}

function validateTargetSymbol(value = DEFAULT_SYMBOL) {
  expect(validTargetSymbol(value), "FLA35_EXPECTED_SYMBOL must be canonical HK.#####");
  return value;
}

function validTargetSymbol(value) { return typeof value === "string" && /^HK\.\d{5}$/.test(value); }

function sameMembershipIdentity(left, right) {
  return record(left) && record(right) && left.id === right.id && left.actorId === right.actorId
    && left.version === right.version && left.symbol === right.symbol && left.state === right.state
    && left.updatedAt === right.updatedAt;
}

function signalProcessGroup(pid, signal) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  try { process.kill(-pid, signal); } catch { /* the process group already exited */ }
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      evidence: { type: "string" },
      help: { type: "boolean", short: "h" }
    },
    allowPositionals: true,
    strict: true
  });
  if (values.help) {
    console.log(HELP);
    return;
  }
  const evidencePath = values.evidence ? await resolveEvidencePath(values.evidence) : null;
  const readAuth = readAuthFromEnv(process.env);
  const symbol = validateTargetSymbol(process.env.FLA35_EXPECTED_SYMBOL);
  validateJourneyEnvironment(process.env, readAuth);
  validateJourneyCommand(positionals);
  const result = await runReadOnlyAcceptance(process.env.API_BASE_URL, process.env.DATABASE_URL, {
    readAuth,
    symbol,
    expectedMembership: {
      id: process.env.FLA35_EXPECTED_MEMBERSHIP_ID,
      version: Number(process.env.FLA35_EXPECTED_MEMBERSHIP_VERSION)
    },
    runJourney: () => runJourneyCommand(positionals, process.env.API_BASE_URL)
  });
  if (evidencePath) await writeAcceptanceEvidence(evidencePath, result);
  console.log(JSON.stringify({ ...result, evidenceWritten: Boolean(evidencePath) }, null, 2));
  if (!result.ok) process.exitCode = 1;
}

function quoteIdent(value) { return `"${value.replaceAll('"', '""')}"`; }
function validateStage(stage, validate) {
  try { return validate(); } catch (error) { throw taggedFailure(error, stage, `${stage.toUpperCase()}_INVALID`); }
}
function taggedFailure(error, failureStage, failureCode) {
  const failure = error instanceof Error ? error : new Error("FLA-35 acceptance failed closed");
  failure.failureStage ??= failureStage;
  failure.failureCode ??= failureCode;
  return failure;
}
function loopback(hostname) { return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]"; }
function record(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function nonEmpty(value) { return typeof value === "string" && value.trim().length > 0; }
function instant(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function expect(condition, message) { if (!condition) throw new Error(message); }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      mode: "read-only",
      error: error instanceof Error ? error.message : "FLA-35 acceptance failed closed"
    }));
    process.exitCode = 1;
  });
}
