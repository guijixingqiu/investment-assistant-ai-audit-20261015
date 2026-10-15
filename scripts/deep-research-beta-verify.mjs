#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { buildServer } from "../dist/apps/api/src/server.js";
import { deepResearchProviderAuthorizationFingerprint } from "../dist/apps/api/src/research/deepResearchGate.js";
import { createScopedResearchToken } from "../dist/apps/api/src/routes/researchAuth.js";
import {
  CLOUD_AI_PROVIDER_POLICY_VERSION,
  DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION,
  EVIDENCE_BOUND_REPORT_CONTRACT_VERSION,
  defaultDeepResearchTaskIntent,
  evidenceBoundReportPackBinding,
  frozenWeinsteinEvidenceBinding
} from "../dist/packages/contracts/src/index.js";
import {
  DECISION_SNAPSHOT_SCHEMA_VERSION,
  portfolioSnapshotStateFromContextStatus
} from "../dist/packages/contracts/src/decisionSnapshotContract.js";
import { runMigrations } from "./migration-runner.mjs";
import { resolveLocalPostgresEndpoint } from "./gate-b-verify.mjs";

const execFileAsync = promisify(execFile);

const bridgeUrl = process.env.FUTU_MARKET_DATA_URL;
assert.ok(bridgeUrl, "FUTU_MARKET_DATA_URL is required");
const devicePreviewPort = Number(process.env.HK_CONNECT_DEVICE_PREVIEW_PORT ?? 0);
assert.ok(Number.isInteger(devicePreviewPort) && devicePreviewPort >= 0 && devicePreviewPort <= 65_535,
  "HK_CONNECT_DEVICE_PREVIEW_PORT must be a valid port");
const devicePreviewCredentialsPath = process.env.HK_CONNECT_DEVICE_PREVIEW_CREDENTIALS_PATH;
if (devicePreviewPort) assert.ok(devicePreviewCredentialsPath, "device preview requires a credentials output path");
const aiProviderRuntimeEnabled = process.env.HK_CONNECT_ENABLE_AI === "1";
const aiApiKey = aiProviderRuntimeEnabled ? process.env.RESEARCH_AI_API_KEY?.trim() : null;
if (aiProviderRuntimeEnabled) assert.ok(aiApiKey && aiApiKey.length >= 20, "HK_CONNECT_ENABLE_AI=1 requires RESEARCH_AI_API_KEY");
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const endpoint = resolveLocalPostgresEndpoint(process.env, userInfo().username);
const runId = randomUUID();
const databaseName = `annual_rings_hkconnect_${Date.now()}_${runId.replaceAll("-", "").slice(0, 8)}`;
const databaseUrl = localDatabaseUrl(databaseName);
const taskRoot = await mkdtemp(join(tmpdir(), "ias-hkconnect-runtime-"));
const rawStoreRoot = join(taskRoot, "raw-store");
const decisionQuantManifestPath = "quant-decision-evidence-catalog.json";
const portfolioQuantManifestPath = "quant-portfolio-run-manifest.json";
const decisionQuantEntries = [];
for (const [symbol, sourcePath, repositoryPath] of [
  ["HK.00175", "artifacts/hk00175-quant-v0.1/run_manifest.json", "quant-hk00175-run-manifest.json"],
  ["HK.00700", "artifacts/hk00700-quant-v0.1/run_manifest.json", "quant-hk00700-run-manifest.json"]
]) {
  const content = await readFile(join(repositoryRoot, sourcePath));
  await writeFile(join(taskRoot, repositoryPath), content, { flag: "wx" });
  decisionQuantEntries.push({
    symbol,
    repositoryPath,
    sha256: createHash("sha256").update(content).digest("hex")
  });
}
const decisionQuantManifest = `${JSON.stringify({
  schemaVersion: "2026-08-17.quant-decision-evidence-catalog.v1",
  generatedAt: new Date().toISOString(),
  entries: decisionQuantEntries
}, null, 2)}\n`;
await writeFile(join(taskRoot, decisionQuantManifestPath), decisionQuantManifest, { flag: "wx" });
const portfolioQuantManifest = await readFile(join(
  repositoryRoot,
  "artifacts/hk-connect-quant-portfolio-v1/latest/run_manifest.json"
));
await writeFile(join(taskRoot, portfolioQuantManifestPath), portfolioQuantManifest, { flag: "wx" });
const decisionQuantManifestSha256 = createHash("sha256").update(decisionQuantManifest).digest("hex");
const portfolioQuantManifestSha256 = createHash("sha256").update(portfolioQuantManifest).digest("hex");
const taskOwnedPortfolioMaxAgeSeconds = 1_800;
const authSigningKey = "hkconnect-runtime-signing-key-2026";
const actorId = "owner-hkconnect-runtime";
const nowSeconds = Math.floor(Date.now() / 1000);
const token = createScopedResearchToken({
  version: 2,
  actorId,
  scopes: ["read", "candidate_write", "research_write", "review_write"],
  issuedAt: nowSeconds,
  expiresAt: nowSeconds + 900,
  tokenId: `hkconnect-${runId}`
}, authSigningKey);
const devicePreviewReadToken = devicePreviewPort ? createScopedResearchToken({
  version: 2,
  actorId,
  scopes: ["read"],
  issuedAt: nowSeconds,
  expiresAt: nowSeconds + 12 * 60 * 60,
  tokenId: `hkconnect-read-${runId}`
}, authSigningKey) : token;
// ponytail: task-owned LAN preview only; add token refresh if a preview must outlive one workday.
const devicePreviewWriteToken = devicePreviewPort ? createScopedResearchToken({
  version: 1,
  actorId,
  scopes: ["read", "candidate_write", "research_write", "review_write"],
  expiresAt: nowSeconds + 12 * 60 * 60
}, authSigningKey) : token;
const headers = { "x-internal-token": token };
const selectedSymbols = ["HK.00175", "HK.00700"];
const officialSources = Object.fromEntries(selectedSymbols.map((symbol) => [symbol, null]));
const noticeEvidenceGaps = [];
const forbiddenTables = [
  "assets_alpha_snapshots", "assets_alpha_trades", "portfolio_positions", "pingan_import_batch_manifests",
  "data_migration_runs", "research_fixture_seed_events"
];

let app;
let pool;
try {
  postgres("createdb", [databaseName]);
  pool = new Pool({ connectionString: databaseUrl, max: 4, ssl: false });
  await runMigrations(pool, { log: () => {} });
  await seedTaskOwnedPortfolio();
  app = await buildServer(serverConfig());
  const cloudAiPolicy = await request("POST", "/api/mobile/research/cloud-ai-policy/decisions", {
    action: "enable", policyVersion: CLOUD_AI_PROVIDER_POLICY_VERSION,
    backupProvider: "none", ownerConfirmed: true, idempotencyKey: `hkconnect-cloud-ai-${runId}`
  });
  assert.equal(cloudAiPolicy.state.status, "enabled");

  const before = await tableCounts(forbiddenTables);
  const decisionReviewBefore = await tableCounts(["pre_trade_decision_checks", "post_decision_reviews"]);
  const health = await externalJson(new URL("/health", bridgeUrl));
  assert.equal(health.ok, true);
  assert.ok(Number.isInteger(health.opendServerVersion) && health.opendServerVersion >= 1006);
  const noticeProofs = [];
  for (const symbol of selectedSymbols) {
    const notice = await fetch(new URL(`/notice-leads?symbol=${symbol}&limit=10`, bridgeUrl), {
      headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000)
    });
    if (!notice.ok) {
      assert.equal(notice.status, 503);
      noticeProofs.push({ symbol, status: "EXTERNAL_BLOCKED", noticeCount: 0, majorNewsCount: 0, httpStatus: notice.status });
      continue;
    }
    const payload = await notice.json();
    assert.equal(payload.requestedSymbol, symbol);
    assert.equal(payload.evidenceStatus, "unverified_source_lead");
    assert.equal(payload.leads.every((item) => ["notice", "major_news"].includes(item.kind)
      && (item.related_securities.length === 0 || item.related_securities.includes(symbol))
      && typeof item.title === "string" && item.title.length > 0
      && typeof item.source === "string" && item.source.length > 0
      && Number.isFinite(Date.parse(item.publish_time)) && /^https:\/\//.test(item.url)), true);
    const noticeCount = payload.leads.filter((item) => item.kind === "notice").length;
    const majorNewsCount = payload.leads.filter((item) => item.kind === "major_news").length;
    noticeProofs.push({ symbol, status: noticeCount ? "RUNTIME_PROVED" : "EXTERNAL_BLOCKED", noticeCount, majorNewsCount });
  }
  const refreshedHealth = await externalJson(new URL("/health", bridgeUrl));
  const noticeCapability = refreshedHealth.capabilities.includes("notice_leads");
  const majorNewsCapability = refreshedHealth.capabilities.includes("major_news_leads");
  assert.equal(noticeCapability, noticeProofs.some((item) => item.httpStatus === undefined));
  const noticeRuntimeProved = noticeProofs.every((item) => item.status === "RUNTIME_PROVED");
  const majorNewsRuntimeProved = majorNewsCapability && noticeProofs.every((item) => item.majorNewsCount > 0);
  if (!noticeRuntimeProved) noticeEvidenceGaps.push(`OpenD ${health.opendServerVersion} NOTICE metadata was not runtime-proved for both selected stocks.`);
  if (!majorNewsRuntimeProved) noticeEvidenceGaps.push(`OpenD ${health.opendServerVersion} major-news metadata was not runtime-proved for both selected stocks.`);

  const discoveries = {};
  for (const symbol of selectedSymbols) {
    const discovery = await readAvailableDiscovery(symbol);
    assert.equal(discovery.candidates.status, "available");
    assert.equal(discovery.candidates.universe.memberCount, 620);
    assert.match(discovery.candidates.universe.snapshotId, /^[a-f0-9]{64}$/);
    assert.equal(discovery.announcements.status, "available");
    assert.ok(discovery.announcements.items.length > 0);
    const announcement = discovery.announcements.items[0];
    assert.equal(announcement.symbol, symbol);
    discoveries[symbol] = discovery;
    officialSources[symbol] = {
      title: announcement.title,
      publishedAt: `${announcement.publishedDate}T00:00:00+08:00`,
      url: announcement.documentUrl,
      sourceVersion: `hkexnews-${announcement.publishedDate}-${announcement.id.slice(0, 12)}`
    };
  }
  const discovery = discoveries["HK.00175"];

  const qualifications = [];
  for (const symbol of selectedSymbols) {
    const currentDiscovery = await request("GET", `/api/mobile/market/discovery?symbol=${symbol}`);
    const qualification = await qualifyCandidate(symbol, currentDiscovery);
    assert.equal(qualification.status, "available");
    assert.equal(qualification.symbol, symbol);
    assert.ok(qualification.facts.length > 0);
    qualifications.push(qualification);
  }
  const qualificationSymbols = qualifications.map((item) => item.symbol).sort();
  assert.deepEqual(qualificationSymbols, [...selectedSymbols].sort());

  const marketAdmissions = {};
  for (const symbol of selectedSymbols) marketAdmissions[symbol] = await proveMarketAdmission(symbol);

  const memberships = {};
  for (const symbol of selectedSymbols) memberships[symbol] = await createAndProveMembership(symbol);
  const initialActionDispositionProof = await proveInitialActionDispositionLifecycle(memberships);

  const records = {};
  for (const symbol of selectedSymbols) {
    records[symbol] = await buildResearchRecord(
      symbol,
      memberships[symbol],
      officialSources[symbol]
    );
  }

  assert.notEqual(records["HK.00175"].membership.id, records["HK.00700"].membership.id);
  assert.notEqual(records["HK.00175"].pack.id, records["HK.00700"].pack.id);
  assert.notEqual(records["HK.00175"].pack.packFingerprint, records["HK.00700"].pack.packFingerprint);
  assert.notEqual(records["HK.00175"].task.id, records["HK.00700"].task.id);
  assert.notEqual(records["HK.00175"].report.id, records["HK.00700"].report.id);
  assert.notEqual(records["HK.00175"].report.reportFingerprint, records["HK.00700"].report.reportFingerprint);
  const aiProviderRuntimeProved = aiProviderRuntimeEnabled
    && selectedSymbols.every((symbol) => records[symbol].task.status === "succeeded");
  const eventEvidenceIds = selectedSymbols.flatMap((symbol) => records[symbol].events.map((event) => event.source.evidenceId));
  assert.equal(new Set(eventEvidenceIds).size, eventEvidenceIds.length);
  const quantPortfolioCheckpoint = await proveQuantPortfolioCheckpoint(records, marketAdmissions);

  const ownerJourneys = [];
  for (const symbol of selectedSymbols) ownerJourneys.push(await completeOwnerJourney(records[symbol]));
  assert.equal(new Set(ownerJourneys.map((journey) => journey.decisionCheckId)).size, selectedSymbols.length);
  assert.equal(new Set(ownerJourneys.map((journey) => journey.reviewId)).size, selectedSymbols.length);
  for (const journey of ownerJourneys) {
    assert.equal(journey.historyCheckIds.includes(journey.decisionCheckId), true);
    assert.equal(ownerJourneys.some((other) => other.symbol !== journey.symbol
      && journey.historyCheckIds.includes(other.decisionCheckId)), false);
  }
  const simulatorProof = await runMultiStockSimulatorProof(records, quantPortfolioCheckpoint);
  const webProof = await runMultiStockWebProof(records);
  const after = await tableCounts(forbiddenTables);
  assert.deepEqual(after, before);
  const decisionReviewAfter = await tableCounts(["pre_trade_decision_checks", "post_decision_reviews"]);
  assert.equal(decisionReviewAfter.pre_trade_decision_checks - decisionReviewBefore.pre_trade_decision_checks, selectedSymbols.length);
  assert.equal(decisionReviewAfter.post_decision_reviews - decisionReviewBefore.post_decision_reviews, selectedSymbols.length);

  const result = {
    ok: true,
    runId,
    gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim(),
    status: simulatorProof
      ? aiProviderRuntimeProved
        ? "NON_EXTERNAL_AJ_ACCEPTANCE_RUNTIME_PROVED_NOTICE_AND_AI_PROVIDER_RUNTIME_PROVED"
        : "NON_EXTERNAL_AJ_ACCEPTANCE_RUNTIME_PROVED_NOTICE_AND_AI_PROVIDER_EXTERNAL_BLOCKED"
      : "PRODUCT_IMPLEMENTATION_CANDIDATE_AND_NARROW_TWO_STOCK_READONLY_RUNTIME_PASS_FULL_GOAL_ACCEPTANCE_GAPS_OPEN",
    selectedResearchSymbols: selectedSymbols,
    qualificationSymbols,
    quantPortfolioCheckpoint,
    acceptance: {
      A: { status: noticeRuntimeProved ? "RUNTIME_PROVED" : "EXTERNAL_BLOCKED",
        opendServerVersion: health.opendServerVersion, noticeCapability, majorNewsCapability, noticeProofs },
      B: { status: "RUNTIME_PROVED", memberCount: 620, snapshotId: discovery.candidates.universe.snapshotId,
        effectiveDate: discovery.candidates.universe.effectiveDate, sourceUrls: discovery.candidates.universe.sourceUrls },
      C: { status: "RUNTIME_PROVED", discoveryQualifications: qualifications.map((item) => item.symbol),
        selectedStockAdmissions: selectedSymbols.map((symbol) => marketAdmissions[symbol].proof),
        memberships: selectedSymbols.map((symbol) => membershipSummary(records[symbol].membership)) },
      D: { status: "RUNTIME_PROVED", sources: selectedSymbols.map((symbol) => records[symbol].sourceProof),
        majorNewsStatus: majorNewsRuntimeProved ? "RUNTIME_PROVED" : "EXTERNAL_BLOCKED", informationLeadProofs: noticeProofs },
      E: { status: "RUNTIME_PROVED", initialActionDispositionProof,
        routing: selectedSymbols.map((symbol) => records[symbol].eventRouting),
        formalDecisionAndTrackingDispositions: ownerJourneys.map((journey) => journey.todayDispositionProof) },
      F: { status: simulatorProof ? "RUNTIME_PROVED" : "IMPLEMENTED", isolatedMemberships: true,
        isolatedMaterials: true, isolatedPacks: true, isolatedTasks: true, isolatedReports: true,
        simulatorStockSwitchClearedStaleComparison: simulatorProof?.stockSwitchClearedStaleComparison ?? false },
      G: { status: aiProviderRuntimeProved ? "RUNTIME_PROVED" : "EXTERNAL_BLOCKED",
        tasks: selectedSymbols.map((symbol) => records[symbol].taskProof) },
      H: { status: simulatorProof ? "RUNTIME_PROVED" : "IMPLEMENTED",
        reports: selectedSymbols.map((symbol) => records[symbol].comparisonProof),
        ownerExplicitSelection: simulatorProof?.ownerExplicitSelection ?? false,
        exactSourceLinksVisible: simulatorProof?.exactSourceLinksVisible ?? false },
      I: { status: "RUNTIME_PROVED", isolatedDecisionHistories: true, journeys: ownerJourneys },
      J: { status: "RUNTIME_PROVED", forbiddenTableDeltas: Object.fromEntries(forbiddenTables.map((table) => [table, after[table] - before[table]])),
        expectedResearchDecisionDelta: selectedSymbols.length, expectedResearchReviewDelta: selectedSymbols.length }
    },
    simulator: simulatorProof,
    web: webProof
  };
  const evidencePath = process.env.HK_CONNECT_EVIDENCE_PATH;
  if (evidencePath) await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify(result, null, 2));
  if (devicePreviewPort) {
    await writeFile(devicePreviewCredentialsPath, `${JSON.stringify({
      readToken: devicePreviewReadToken,
      writeToken: devicePreviewWriteToken
    }, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600
    });
    await app.listen({ host: "0.0.0.0", port: devicePreviewPort });
    console.log(JSON.stringify({ devicePreview: "ready", port: devicePreviewPort }));
    await new Promise((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
  }
} finally {
  if (app) await app.close().catch(() => {});
  if (pool) await pool.end().catch(() => {});
  postgres("dropdb", ["--if-exists", "--force", databaseName], true);
  execFileSync("/usr/bin/find", [taskRoot, "-depth", "-delete"], { stdio: "ignore" });
}

async function createAndProveMembership(symbol) {
  const code = symbol.slice(3);
  const idempotencyKey = `hkconnect-membership-${code}`;
  const payload = { market: "HK", code, initialState: "tracked", idempotencyKey };
  const concurrent = await Promise.all([
    rawRequest("POST", "/api/mobile/research/candidate-memberships", payload),
    rawRequest("POST", "/api/mobile/research/candidate-memberships", payload)
  ]);
  assert.deepEqual(concurrent.map((item) => item.statusCode).sort((a, b) => a - b), [200, 201]);
  const first = concurrent[0].body.data;
  assert.equal(concurrent[1].body.data.id, first.id);
  const replay = await request("POST", "/api/mobile/research/candidate-memberships", payload);
  assert.equal(replay.data.id, first.id);
  const conflict = await rawRequest("POST", "/api/mobile/research/candidate-memberships", {
    ...payload, initialState: "paused"
  });
  assert.equal(conflict.statusCode, 409);
  const fresh = await request("GET", "/api/mobile/research/candidate-memberships");
  const exact = fresh.memberships.filter((item) => item.symbol === symbol && item.state === "tracked");
  assert.equal(exact.length, 1);
  assert.equal(exact[0].id, first.id);
  return exact[0];
}

async function proveInitialActionDispositionLifecycle(memberships) {
  const before = await request("GET", "/api/mobile/research/today/inbox");
  const actions = selectedSymbols.map((symbol) => exactInitialTodayAction(before, memberships[symbol]));
  const snoozedUntil = new Date(Date.now() + 5_000).toISOString();
  for (const item of actions) await writeTodayDisposition(item, "later", snoozedUntil, `initial-${item.membership.id}-later`);
  const deferred = await request("GET", "/api/mobile/research/today/inbox");
  for (const item of actions) assertTodayActionIdentity(item, exactTodayAction(deferred, item.membership, item.kind), "later");
  const waitMs = Math.max(0, Date.parse(snoozedUntil) - Date.now() + 100);
  if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
  const returned = await request("GET", "/api/mobile/research/today/inbox");
  for (const item of actions) {
    const current = exactTodayAction(returned, item.membership, item.kind);
    assertTodayActionIdentity(item, current, "new");
    assert.equal(current.summary, item.summary);
  }
  return actions.map((item) => ({ symbol: item.symbol, kind: item.kind, itemId: item.id, sourceFingerprint: item.source.sourceFingerprint,
    deferred: true, freshReadback: true, returnedAfterExpiry: true }));
}

async function proveImmediateTodayRestore(membership, kind, label) {
  const before = exactTodayAction(await request("GET", "/api/mobile/research/today/inbox"), membership, kind);
  const snoozedUntil = new Date(Date.now() + 86_400_000).toISOString();
  await writeTodayDisposition(before, "later", snoozedUntil, `${label}-later`);
  const deferred = exactTodayAction(await request("GET", "/api/mobile/research/today/inbox"), membership, kind);
  assertTodayActionIdentity(before, deferred, "later");
  await writeTodayDisposition(deferred, "new", null, `${label}-restore`);
  const restored = exactTodayAction(await request("GET", "/api/mobile/research/today/inbox"), membership, kind);
  assertTodayActionIdentity(before, restored, "new");
  return { item: restored, proof: { kind, itemId: before.id, sourceFingerprint: before.source.sourceFingerprint,
    deferred: true, freshDeferredReadback: true, explicitlyRestored: true, freshRestoredReadback: true } };
}

async function writeTodayDisposition(item, state, snoozedUntil, suffix) {
  const response = await request("POST", "/api/mobile/research/today/inbox/material-dispositions", {
    itemId: item.id, membershipVersion: item.membership.version, sourceFingerprint: item.source.sourceFingerprint,
    state, snoozedUntil, idempotencyKey: `hkconnect-today-${suffix}`
  });
  assert.equal(response.data.itemId, item.id);
  assert.equal(response.data.sourceFingerprint, item.source.sourceFingerprint);
  assert.equal(response.data.state, state);
  assert.equal(response.data.snoozedUntil, snoozedUntil);
}

function exactTodayAction(inbox, membership, kind) {
  const matches = inbox.items.filter((item) => item.membership.id === membership.id && item.kind === kind);
  assert.equal(matches.length, 1, `${membership.symbol} expected one ${kind} Today action`);
  assert.match(matches[0].source.sourceFingerprint, /^[a-f0-9]{64}$/);
  return matches[0];
}

function exactInitialTodayAction(inbox, membership) {
  const matches = inbox.items.filter((item) => item.membership.id === membership.id
    && ["candidate_found", "research"].includes(item.kind) && item.state === "new");
  assert.equal(matches.length, 1, `${membership.symbol} expected one initial Today action`);
  assert.match(matches[0].source.sourceFingerprint, /^[a-f0-9]{64}$/);
  return matches[0];
}

function assertTodayActionIdentity(expected, current, state) {
  assert.equal(current.id, expected.id);
  assert.equal(current.membership.id, expected.membership.id);
  assert.equal(current.membership.version, expected.membership.version);
  assert.equal(current.source.id, expected.source.id);
  assert.equal(current.source.version, expected.source.version);
  assert.equal(current.source.sourceFingerprint, expected.source.sourceFingerprint);
  assert.equal(current.state, state);
}

async function proveMarketAdmission(symbol) {
  const code = symbol.slice(3);
  const search = await request("GET", `/api/mobile/market/search?q=${code}`);
  assert.equal(search.status, "available");
  assert.equal(search.results.some((item) => item.symbol === symbol), true);
  await request("POST", `/api/internal/market/refresh/HK/${code}`, {});
  const quote = await request("GET", `/api/mobile/market/quotes/HK/${code}`);
  assert.equal(quote.requestedSymbol, symbol);
  assert.equal(quote.data?.symbol, symbol);
  assert.ok(["live", "stale"].includes(quote.status));
  const environment = await request("GET", `/api/mobile/market/environment/HK/${code}`);
  assert.equal(environment.status, "available");
  assert.equal(environment.requestedSymbol, symbol);
  assert.equal(environment.data?.selectedSymbol, symbol);
  const dailyEnvelope = await request("POST", `/api/internal/market/daily-bars/refresh/HK/${code}`, {});
  assert.equal(dailyEnvelope.completeness, "complete");
  assert.equal(dailyEnvelope.usableForRequestedCutoff, true);
  assert.equal(dailyEnvelope.dailyBars.request.symbol, symbol);
  return {
    dailyEnvelope,
    proof: {
      symbol,
      searchProvider: search.source.provider,
      quoteStatus: quote.status,
      quoteProvider: quote.source.provider,
      marketState: environment.data.marketState,
      dailyCutoff: dailyEnvelope.dailyBars.request.cutoff,
      dailySnapshotSha: dailyEnvelope.dailyBars.snapshot.snapshotSha
    }
  };
}

async function qualifyCandidate(symbol, initialDiscovery) {
  let discovery = initialDiscovery;
  let lastFailure = "no response";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = discovery.candidates.candidates.find((item) => item.symbol === symbol);
    if (!candidate) {
      lastFailure = `${symbol} candidate is temporarily unavailable`;
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1_000));
      discovery = await request("GET", `/api/mobile/market/discovery?symbol=${symbol}`);
      continue;
    }
    const response = await rawRequest("POST", "/api/mobile/market/discovery/qualifications", {
      candidate, discoveryFetchedAt: discovery.candidates.fetchedAt
    });
    if (response.statusCode === 200) return response.body;
    lastFailure = response.rawPayload.toString("utf8");
    assert.ok([409, 503].includes(response.statusCode), response.rawPayload.toString("utf8"));
    if (response.statusCode === 409) discovery = await request("GET", `/api/mobile/market/discovery?symbol=${symbol}`);
    else await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1_000));
  }
  assert.fail(`${symbol} candidate kept drifting after ten explicit retries: ${lastFailure}`);
}

async function readAvailableDiscovery(symbol) {
  let discovery;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    discovery = await request("GET", `/api/mobile/market/discovery?symbol=${symbol}`);
    if (discovery.candidates.status === "available" && discovery.announcements.status === "available") return discovery;
    await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1_000));
  }
  assert.fail(`${symbol} discovery remained unavailable after ten explicit reads: ${JSON.stringify(discovery)}`);
}

async function buildResearchRecord(symbol, membership, source) {
  const code = symbol.slice(3);
  const monitorRule = {
    variableName: "official_disclosures",
    category: "financial_report",
    source: source.url,
    cadence: "on_event",
    threshold: "Route each new issuer-official disclosure by deterministic impact.",
    reason: "Keep material changes visible in Today without automatic decisions.",
    enabled: true
  };
  await request("PUT", `/api/mobile/research/profiles/HK/${code}`, {
    membershipId: membership.id,
    membershipVersion: membership.version,
    name: symbol === "HK.00175" ? "Geely Automobile" : "Tencent Holdings",
    currentView: "Research-only neutral view pending complete evidence.",
    currentThesis: "Issuer evidence must remain current and exactly bound.",
    marketDisagreement: null,
    invalidationCondition: "Official source or exact binding changes.",
    nextReviewOn: hongKongDate(),
    keyVariables: ["official_disclosures"],
    catalysts: ["issuer disclosure"],
    evidenceGaps: noticeEvidenceGaps,
    monitorRules: [monitorRule],
    idempotencyKey: `hkconnect-profile-${code}`
  });
  const profile = await request("GET", `/api/mobile/research/profiles/HK/${code}`);
  assert.equal(profile.data.profile.monitorRules.length, 1);
  const confirmedMonitorRule = profile.data.profile.monitorRules[0];
  const { version, confirmedAt, ...savedMonitorRule } = confirmedMonitorRule;
  assert.deepEqual(savedMonitorRule, monitorRule);
  assert.ok(Number.isSafeInteger(version) && version > 0);
  assert.ok(Number.isFinite(Date.parse(confirmedAt)));
  const profileDisposition = await proveImmediateTodayRestore(membership, "research_profile_review_due", `profile-${code}`);

  const pdfBytes = await fetchExternalBytes(source.url);
  assert.equal(pdfBytes.subarray(0, 5).toString(), "%PDF-");
  const imported = await importPdf(membership, source, pdfBytes);
  const document = imported.data.document;
  const page = await firstTextPage(membership.id, document);
  const confirmed = await request("POST", `/api/mobile/research/candidate-memberships/${membership.id}/documents/${document.id}/confirmed-facts`, {
    membershipVersion: membership.version,
    pageNumber: page.pageNumber,
    quote: page.normalizedText,
    statement: `Owner-confirmed searchable text from ${source.title}.`,
    validUntil: "2027-12-31T23:59:59.000Z",
    replacesMaterialId: null,
    idempotencyKey: `hkconnect-pdf-fact-${code}`
  });

  const scores = [
    { label: "high", materiality: 5, reliability: 5, stance: "support", kind: "financial_report" },
    { label: "medium", materiality: 3, reliability: 3, stance: "support", kind: "major_news" },
    { label: "low", materiality: 2, reliability: 2, stance: "refute", kind: "corporate_action" }
  ];
  const events = [];
  for (const score of scores) {
    const material = await createMaterial(symbol, membership, source, score);
    const eventPayload = {
      membershipVersion: membership.version,
      materialId: material.id,
      eventKind: score.kind,
      coverageScope: "research_stock",
      monitorRuleBinding: score.kind === confirmedMonitorRule.category ? confirmedMonitorRule : null,
      idempotencyKey: `hkconnect-event-${code}-${score.label}`
    };
    const event = await request("POST", `/api/mobile/research/candidate-memberships/${membership.id}/research-events`, eventPayload);
    const replay = await request("POST", `/api/mobile/research/candidate-memberships/${membership.id}/research-events`, eventPayload);
    assert.equal(replay.data.id, event.data.id);
    assert.equal(event.data.importance, score.label);
    assert.equal(event.data.symbol, symbol);
    assert.equal(event.data.membershipId, membership.id);
    assert.deepEqual(event.data.monitorRuleBinding, eventPayload.monitorRuleBinding);
    events.push(event.data);
  }
  const today = await request("GET", `/api/mobile/research/candidate-memberships/${membership.id}/today`);
  const eventItems = today.items.filter((item) => item.id.startsWith("event:"));
  assert.equal(eventItems.length, events.length);
  assert.deepEqual([...new Set(eventItems.map((item) => item.priority))].sort(), ["high", "low", "medium"]);
  const freshToday = await request("GET", `/api/mobile/research/candidate-memberships/${membership.id}/today`);
  assert.deepEqual(
    freshToday.items.filter((item) => item.id.startsWith("event:")).map((item) => item.bindings.eventRefs),
    eventItems.map((item) => item.bindings.eventRefs)
  );
  const boundEvent = events.find((item) => item.monitorRuleBinding !== null);
  const boundTodayRef = freshToday.items.flatMap((item) => item.bindings.eventRefs)
    .find((ref) => ref.eventId === boundEvent?.id);
  assert.deepEqual(boundEvent?.monitorRuleBinding, confirmedMonitorRule);
  assert.deepEqual(boundTodayRef?.monitorRuleBinding, confirmedMonitorRule);

  const fundamentals = await createFundamentals(membership, confirmed.data);
  const valuations = await createValuations(membership, fundamentals.anchors);
  const context = await createResearchContext(membership, confirmed.data, source);
  assert.equal(context.membershipId, membership.id);
  const daily = await request("GET", `/api/mobile/market/daily-bars/HK/${code}`);
  assert.equal(daily.usableForRequestedCutoff, true);
  const freshValuations = await request(
    "GET", `/api/mobile/research/candidate-memberships/${membership.id}/valuation-scenarios`
  );
  const currentValuations = freshValuations.scenarioSets.filter((item) =>
    valuations.some((created) => created.id === item.id)
      && item.recomputable
      && item.scenarioState === "current"
  );
  assert.equal(currentValuations.length, 2);
  const analysisAsOf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
  const weinstein = await request("GET", `/api/mobile/market/weinstein/HK/${code}?analysisAsOf=${analysisAsOf}`);
  const expectedWeinstein = frozenWeinsteinEvidenceBinding(weinstein);
  assert.ok(expectedWeinstein);
  const selectedValuation = currentValuations[0];
  assert.ok(selectedValuation);
  const pack = await request("POST", `/api/mobile/research/candidate-memberships/${membership.id}/evidence-packs`, {
    membershipVersion: membership.version,
    expectedScenarioId: selectedValuation.id,
    expectedScenarioRevision: selectedValuation.revision,
    expectedValuationMethods: currentValuations.map((item) => ({
      scenarioId: item.id, scenarioRevision: item.revision, methodId: item.calculation.method.id
    })),
    expectedTechnicalSnapshotSha: daily.dailyBars.snapshot.snapshotSha,
    expectedTechnicalResultHash: daily.technical.resultHash,
    expectedWeinstein,
    idempotencyKey: `hkconnect-pack-${code}`
  });

  const intent = defaultDeepResearchTaskIntent(pack.data);
  intent.monitorRules = [confirmedMonitorRule];
  intent.providerAuthorization.ownerConfirmed = true;
  intent.providerAuthorization.confirmedIntentFingerprint = deepResearchProviderAuthorizationFingerprint(intent);
  const task = await request("POST", `/api/mobile/research/candidate-memberships/${membership.id}/deep-research-tasks`, {
    membershipVersion: membership.version,
    evidencePackId: pack.data.id,
    evidencePackBinding: evidenceBoundReportPackBinding(pack.data),
    intent,
    reportContractVersion: DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION,
    idempotencyKey: `hkconnect-task-${code}`
  }, 202);
  const terminalTask = await pollTask(membership.id, task.data.id);
  let completedTask = terminalTask;
  if (aiProviderRuntimeEnabled) {
    assert.equal(terminalTask.status, "ready_to_absorb",
      `provider task failed: errorCode=${terminalTask.errorCode ?? "UNKNOWN"}, modelUsage=${terminalTask.modelUsage}`);
    assert.equal(terminalTask.synthesis.provider, "deepseek");
    assert.equal(terminalTask.synthesis.model, "deepseek-flash");
    assert.match(terminalTask.synthesis.tokenUsage, /^prompt=\d+,completion=\d+,total=\d+$/);
    assert.match(terminalTask.synthesis.cost, /^(estimated_usd=\d+\.\d{8};pricing=2026-09-10\.peak|UNKNOWN)$/);
    assert.equal(terminalTask.synthesis.sendManifest.membershipId, membership.id);
    assert.equal(terminalTask.synthesis.sendManifest.symbol, symbol);
    assert.equal(terminalTask.synthesis.sendManifest.fullPdfSent, false);
    assert.equal(terminalTask.synthesis.sendManifest.credentialsSent, false);
    assert.equal(terminalTask.synthesis.sendManifest.officialAssetFactsSent, false);
    completedTask = (await request(
      "POST",
      `/api/mobile/research/candidate-memberships/${membership.id}/deep-research-tasks/${terminalTask.id}/absorb`,
      {
        membershipVersion: membership.version,
        taskRequestFingerprint: terminalTask.requestFingerprint,
        snapshotId: terminalTask.snapshotBinding.snapshotId,
        idempotencyKey: `hkconnect-task-absorb-${code}`
      }
    )).data;
    assert.equal(completedTask.status, "succeeded");
    assert.ok(completedTask.report);
  } else {
    assert.equal(terminalTask.status, "failed");
    assert.equal(terminalTask.errorCode, "provider_unavailable_or_invalid");
    assert.equal(terminalTask.report, null);
  }

  const report = await request("POST", `/api/mobile/research/candidate-memberships/${membership.id}/deep-research-reports`,
    reportPayload(membership, pack.data, events, `hkconnect-report-${code}`));
  assert.equal(report.data.status, "complete_pending_confirmation");
  const completeness = await request("POST", `/api/mobile/research/candidate-memberships/${membership.id}/completeness`, {
    membershipVersion: membership.version,
    baseSnapshotId: null,
    expectedFundamentalsDataCutoffAt: fundamentals.envelope.dataCutoffAt,
    expectedResearchContextId: context.id,
    externalSections: ["valuation", "quant", "weinstein", "risks", "counterevidence", "conflicts"].map((section) => ({
      section, status: "unknown", coverage: { achieved: 0, required: 1 }, sourceBindings: [],
      gaps: [`${section} is derived by the server and remains UNKNOWN until exact readback`]
    })),
    validUntil: "2027-12-31T23:59:59.000Z",
    ownerConfirmed: true,
    idempotencyKey: `hkconnect-completeness-${code}`
  });
  assert.equal(completeness.data.confirmationEligible, true, JSON.stringify(completeness.data.sections));
  const decision = await request("POST", `/api/mobile/research/candidate-memberships/${membership.id}/deep-research-reports/${report.data.id}/decisions`, {
    membershipVersion: membership.version,
    decision: "confirmed",
    note: "Owner confirms this exact research-only report version for runtime verification.",
    idempotencyKey: `hkconnect-report-confirm-${code}`
  });
  assert.equal(decision.data.decision, "confirmed");
  const workspace = await request("GET", `/api/mobile/research/candidate-memberships/${membership.id}/deep-research`);
  assert.equal(workspace.data.latestReport.id, report.data.id);
  assert.equal(workspace.data.latestPack.id, pack.data.id);
  assert.equal(workspace.data.target.symbol, symbol);
  const reopenedPage = await request("GET", `/api/mobile/research/candidate-memberships/${membership.id}/documents/${document.id}/pages/${page.pageNumber}`);
  assert.equal(reopenedPage.pageTextSha256, page.pageTextSha256);
  const reopenedPdf = await rawRequest("GET", `/api/mobile/research/candidate-memberships/${membership.id}/documents/${document.id}/content`);
  assert.equal(createHash("sha256").update(reopenedPdf.rawPayload).digest("hex"), document.pdfSha256);

  return {
    symbol, membership, document, page, confirmed: confirmed.data, events,
    pack: pack.data, task: completedTask, report: report.data, reportDecision: decision.data,
    sourceProof: {
      symbol, title: source.title, url: source.url, publishedAt: source.publishedAt,
      fetchedAt: document.importedAt, fingerprint: document.pdfSha256, sourceVersion: source.sourceVersion,
      verificationState: "owner_declared_official_searchable_pdf"
    },
    eventRouting: { symbol, rule: confirmedMonitorRule, profileDisposition: profileDisposition.proof,
      priorities: eventItems.map((item) => item.priority).sort() },
    taskProof: { symbol, packId: pack.data.id, packFingerprint: pack.data.packFingerprint,
      taskId: completedTask.id, taskStatus: completedTask.status, errorCode: completedTask.errorCode,
      report: completedTask.report, synthesis: completedTask.synthesis },
    comparisonProof: { symbol, reportId: report.data.id, reportVersion: report.data.version,
      reportFingerprint: report.data.reportFingerprint, evidencePackId: pack.data.id,
      evidencePackFingerprint: pack.data.packFingerprint, cutoffAt: report.data.payload.cutoffAt,
      currentness: workspace.data.latestReport.currentness,
      reopenedDocumentId: document.id, reopenedPageNumber: page.pageNumber, reopenedPageTextSha256: page.pageTextSha256 }
  };
}

async function createMaterial(symbol, membership, source, score) {
  const code = symbol.slice(3);
  const publishedAt = source.publishedAt;
  return (await request("POST", `/api/mobile/research/profiles/HK/${code}/materials`, {
    membershipId: membership.id,
    membershipVersion: membership.version,
    title: `${source.title} ${score.label} impact signal`,
    contentText: `Owner verified the issuer-official source metadata for ${symbol}; this ${score.label} impact input remains research-only.`,
    sourceType: "issuer_disclosure",
    sourceUrl: source.url,
    publishedAt,
    claimType: "issuer_statement",
    verificationStatus: "verified",
    rightsStatus: "authorized_public",
    sourceVersion: `${source.sourceVersion}-${score.label}`,
    replacesMaterialId: null,
    validUntil: "2027-12-31T23:59:59.000Z",
    summary: `${score.label} impact issuer-official source input for ${symbol}.`,
    variableName: "official_disclosures",
    stance: score.stance,
    reliability: score.reliability,
    materiality: score.materiality,
    isRead: true,
    idempotencyKey: `hkconnect-material-${code}-${score.label}`
  })).data;
}

async function createFundamentals(membership, sourceMaterial) {
  const values = [];
  const metrics = [
    ["revenue", "duration"], ["profit_attributable_to_owners", "duration"],
    ["operating_cash_flow", "duration"], ["total_assets", "instant"], ["total_liabilities", "instant"]
  ];
  const periods = [
    ["2021-01-01", "2021-12-31"], ["2022-01-01", "2022-12-31"],
    ["2023-01-01", "2023-12-31"], ["2024-01-01", "2024-12-31"],
    ["2025-01-01", "2025-12-31"], ["2026-01-01", "2026-06-30"]
  ];
  for (const [periodIndex, [periodStart, periodEnd]] of periods.entries()) {
    for (const [metricIndex, [metric, periodKind]] of metrics.entries()) {
      const item = { metric, periodKind, periodStart: periodKind === "duration" ? periodStart : null,
        periodEnd, value: String((periodIndex + 1) * 100000 + (metricIndex + 1) * 1000) };
    const response = await request("POST", `/api/mobile/research/candidate-memberships/${membership.id}/fundamentals`, {
      membershipVersion: membership.version,
      sourceMaterialId: sourceMaterial.id,
      metric: item.metric,
      periodKind: item.periodKind,
      periodStart: item.periodStart,
      periodEnd: item.periodEnd,
      currency: "HKD",
      unitScale: 1_000_000,
      scope: "consolidated",
      valueStatus: "reported",
      value: item.value,
      comparability: "comparable",
      comparabilityReason: null,
      amendmentKind: "initial",
      replacesValueId: null,
      ownerConfirmed: true,
      idempotencyKey: `hkconnect-fundamental-${membership.id}-${item.periodEnd}-${item.metric}`
    });
    values.push(response.data);
    }
  }
  const fresh = await request("GET", `/api/mobile/research/candidate-memberships/${membership.id}/fundamentals`);
  assert.equal(fresh.values.filter((item) => values.some((value) => value.id === item.id)).length, values.length);
  assert.equal(fresh.financialCoverage.status, "available");
  const anchors = Object.fromEntries(values.filter((item) => item.periodEnd === "2025-12-31")
    .map((item) => [item.metric, item]));
  return { anchors, envelope: fresh };
}

async function createValuations(membership, fundamentals) {
  const assumptions = {
    metricCurrency: "HKD",
    baseMetricPerShare: 12.5,
    annualGrowthRate: 0.1,
    horizonYears: 3,
    terminalMultiple: 18,
    annualDiscountRate: 0.12,
    netCashPerShare: 2,
    growthRateStep: 0.03,
    multipleStep: 2
  };
  const created = [];
  for (const [label, anchor, methodId] of [
    ["forward", fundamentals.revenue, "discounted_forward_metric_multiple_user_scenario"],
    ["assets", fundamentals.total_assets, "adjusted_net_asset_value_user_scenario"]
  ]) {
    const response = await request("POST", `/api/mobile/research/candidate-memberships/${membership.id}/valuation-scenarios`, {
      membershipVersion: membership.version,
      symbol: membership.symbol,
      anchorValueId: anchor.id,
      replacesScenarioSetId: null,
      assumptions: { ...assumptions, methodId },
      ownerConfirmed: true,
      idempotencyKey: `hkconnect-valuation-${membership.id}-${label}`
    });
    created.push(response.data);
  }
  const methods = created.map((item) => item.calculation.method.id).sort();
  assert.deepEqual(methods, ["adjusted_net_asset_value_user_scenario", "discounted_forward_metric_multiple_user_scenario"]);
  const fresh = await request("GET", `/api/mobile/research/candidate-memberships/${membership.id}/valuation-scenarios`);
  assert.equal(fresh.scenarioSets.filter((item) => created.some((value) => value.id === item.id) && item.recomputable).length, 2);
  return created;
}

async function createResearchContext(membership, material, source) {
  const asOf = material.capturedAt;
  const cutoffAt = material.capturedAt;
  const citation = {
    documentId: material.citation.documentId,
    pageNumber: material.citation.pageNumber,
    pageTextSha256: material.citation.pageTextSha256,
    sourceType: material.sourceType,
    sourceUrl: source.url,
    sourceVersion: material.sourceVersion
  };
  const provenance = {
    sourceType: material.sourceType,
    sourceVersion: material.sourceVersion,
    capturedAt: material.capturedAt,
    classification: "user_provided"
  };
  const bound = { selectedSymbol: membership.symbol, asOf, cutoffAt, validUntil: material.validUntil, citation, provenance };
  const peerSymbols = ["HK.00005", "HK.00941", "HK.03690"].filter((symbol) => symbol !== membership.symbol);
  const operatingKpis = ["2023", "2024", "2025"].flatMap((year, index) => [
    { id: String(index * 2 + 1), ...bound, category: "operating", metric: "owner_transcribed_operating_index",
      periodStart: `${year}-01-01`, periodEnd: `${year}-12-31`, valueStatus: "reported", value: String(100 + index),
      unit: "index", comparability: "comparable", comparabilityReason: null },
    { id: String(index * 2 + 2), ...bound, category: "price", metric: "owner_transcribed_price_index",
      periodStart: `${year}-01-01`, periodEnd: `${year}-12-31`, valueStatus: "reported", value: String(200 + index),
      unit: "index", comparability: "comparable", comparabilityReason: null }
  ]);
  const industryDrivers = ["supply", "demand", "pricing", "competition", "policy", "cycle"].map((dimension, index) => ({
    id: String(101 + index), ...bound, kind: "industry", dimension, impact: "mixed",
    statement: `Owner-transcribed ${dimension} context remains research-only.`,
    thesisRelevance: `${dimension} can change the evidence-bound thesis.`
  }));
  return (await request("POST", `/api/mobile/research/candidate-memberships/${membership.id}/research-context`, {
    baseContextId: null,
    membershipVersion: membership.version,
    selectedSymbol: membership.symbol,
    industry: membership.symbol === "HK.00175" ? "automotive" : "internet_platforms",
    selectedFacts: [{
      id: membership.id,
      selectedSymbol: membership.symbol,
      symbol: membership.symbol,
      metric: "official_disclosure_count",
      value: "1",
      unit: "count",
      currency: null,
      asOf,
      cutoffAt,
      validUntil: material.validUntil,
      citation,
      provenance
    }],
    peerFacts: peerSymbols.map((symbol, index) => ({
      id: String(201 + index), selectedSymbol: membership.symbol, symbol,
      metric: "official_disclosure_count", value: "1", unit: "count", currency: null,
      asOf, cutoffAt, validUntil: material.validUntil, citation, provenance
    })),
    peers: peerSymbols.map((symbol, index) => ({ id: String(index + 1), ...bound, symbol,
      name: `Peer ${symbol}`, status: "included", reason: "Owner-selected comparable company for research coverage." })),
    operatingKpis,
    macroDrivers: [{ id: "100", ...bound, kind: "macro", dimension: "rates", impact: "mixed",
      statement: "Owner-transcribed rate context remains research-only.", thesisRelevance: "Rates can affect valuation and demand." }],
    industryDrivers,
    unknowns: ["Peer and macro comparison remains UNKNOWN."],
    provenance,
    asOf,
    cutoffAt,
    validUntil: material.validUntil,
    idempotencyKey: `hkconnect-context-${membership.id}`
  })).data;
}

function reportPayload(membership, pack, events, idempotencyKey) {
  const byEvidenceId = new Map(pack.items.map((item) => [item.evidenceId, item]));
  const high = eventMaterial(events.find((item) => item.importance === "high"), byEvidenceId);
  const medium = eventMaterial(events.find((item) => item.importance === "medium"), byEvidenceId);
  const low = eventMaterial(events.find((item) => item.importance === "low"), byEvidenceId);
  const materialFact = (item, statement = item.summary) => ({
    statement,
    evidenceIds: [item.evidenceId],
    sourceKind: "material",
    claimType: item.claimType,
    stance: item.stance
  });
  return {
    membershipVersion: membership.version,
    evidencePackId: pack.id,
    idempotencyKey,
    reportContractVersion: EVIDENCE_BOUND_REPORT_CONTRACT_VERSION,
    evidencePackBinding: evidenceBoundReportPackBinding(pack),
    reproducibility: {
      generationMethod: "deterministic_frozen_fact_framework",
      model: "NOT_USED",
      prompt: "NOT_USED",
      provider: "NOT_USED",
      tokenUsage: "NOT_USED",
      cost: "NOT_USED"
    },
    adviceLayer: {
      conclusion: `Current exact evidence for ${membership.symbol} supports continued observation only.`,
      confidence: "low",
      applicableUntil: "2027-12-31T23:59:59.000Z",
      horizonStatement: "Long-term and medium-term research views remain separate.",
      longTerm: {
        view: "Continue evidence collection without an automatic decision.",
        conditions: ["Issuer sources and the exact pack remain current."],
        invalidationConditions: ["Official source or exact evidence binding changes."],
        risks: ["Financial and competitive evidence remains incomplete."]
      },
      mediumShortTerm: {
        view: "No automatic signal; monitor exact disclosures.",
        conditions: ["Daily technical and Weinstein bindings remain current."],
        invalidationConditions: ["Technical snapshot or stage evidence changes."],
        risks: ["Short-term catalyst timing remains UNKNOWN."]
      },
      conflict: {
        status: "conflict",
        description: "High-impact support and low-impact counterevidence remain visible together."
      },
      direction: "watch",
      priceConditions: ["Reassess only after fresh exact evidence; this is not an order condition."],
      priceRange: "UNKNOWN",
      researchPositionRange: "research-only 0-5%; not an official portfolio instruction",
      assumptions: ["Current official PDF and frozen evidence remain valid."],
      scenarios: ["Base: continue monitoring; bear: evidence weakens; bull: evidence strengthens."],
      nextQuestion: "What changed in the next issuer-official disclosure?",
      versionChange: "Initial exact multi-stock runtime report.",
      automaticTradingSignal: false
    },
    researchLayer: {
      fundamentals: [materialFact(high)],
      eventsAndCatalysts: [materialFact(high), materialFact(medium)],
      risks: [materialFact(low)],
      counterevidence: [materialFact(low)],
      unknowns: [{
        statement: "counterevidence=source_missing/UNKNOWN beyond the selected official inputs",
        evidenceIds: [], sourceKind: "source_missing", claimType: "UNKNOWN", stance: "UNKNOWN"
      }],
      sourceConflicts: [{
        description: "Selected supportive and adverse signals address different research variables.",
        evidenceIds: [high.evidenceId, low.evidenceId]
      }],
      nextValidationQuestions: ["Which fresh official disclosure changes the current thesis?" ]
    },
    changeFromPrevious: "Initial exact multi-stock runtime report."
  };
}

function eventMaterial(event, byEvidenceId) {
  assert.ok(event, "expected event importance is missing");
  const material = byEvidenceId.get(event.source.evidenceId);
  assert.ok(material, "event material is outside the exact evidence pack");
  return material;
}

async function completeOwnerJourney(record) {
  const code = record.symbol.slice(3);
  await request("POST", `/api/internal/market/refresh/HK/${record.symbol.slice(3)}`, {});
  const beforeInbox = await request("GET", "/api/mobile/research/today/inbox");
  const due = beforeInbox.items.find((item) => item.kind === "formal_decision_due"
    && item.membership.id === record.membership.id
    && item.reviewEvent?.reportBinding?.reportId === record.report.id);
  assert.ok(due, `${record.symbol} formal decision due item is missing`);
  const formalDisposition = await proveImmediateTodayRestore(record.membership, "formal_decision_due", `formal-${code}`);
  const binding = formalDisposition.item.reviewEvent.reportBinding;
  const context = await request("GET", `/api/mobile/research/decision-context/HK/${record.symbol.slice(3)}`);
  const portfolioContext = await request("GET", "/api/mobile/research/portfolio/pingan-current/context");
  assert.ok(["available", "stale"].includes(portfolioContext.status));
  assert.equal(portfolioContext.freshness.tradingMaxAgeSeconds, taskOwnedPortfolioMaxAgeSeconds);
  const riskResponse = await rawRequest("GET", `/api/mobile/research/portfolio/pingan-current/risk-impact?symbol=${record.symbol}&hypotheticalAmount=10000`);
  assert.equal(riskResponse.statusCode, portfolioContext.status === "available" ? 200 : 409);
  const riskImpact = riskResponse.body;
  const riskCaptured = riskImpact.status === "available";
  assert.equal(riskImpact.status, portfolioContext.status === "available" ? "available" : "blocked");
  const decisionSnapshotBinding = {
    schemaVersion: DECISION_SNAPSHOT_SCHEMA_VERSION,
    portfolioContext: {
      state: portfolioSnapshotStateFromContextStatus(portfolioContext.status),
      contextId: portfolioContext.contextId,
      portfolioSnapshotId: portfolioContext.portfolioSnapshotId,
      accountScopeId: portfolioContext.accountScopeId
    },
    riskImpact: {
      availability: riskCaptured ? "captured" : "not_captured",
      impactId: riskCaptured ? riskImpact.impactId : null,
      calculationVersion: riskCaptured ? riskImpact.calculationVersion : null,
      contextId: riskCaptured ? riskImpact.contextId : null,
      portfolioSnapshotId: riskCaptured ? riskImpact.portfolioSnapshotId : null,
      candidateSymbol: riskCaptured ? riskImpact.candidateSymbol : null,
      hypotheticalAmount: riskCaptured ? riskImpact.hypotheticalAmount : null
    }
  };
  const personalRisk = {
    limits: {
      maxCandidateWeight: 0.2,
      maxLargestPositionWeight: 0.5,
      maxPortfolioHhi: 0.4,
      maxUnrealizedLossHkd: 0
    },
    overrideReason: "Owner accepts the visible research-only concentration warning for this exact snapshot.",
    secondConfirmed: true
  };
  const decisionPayload = {
    decisionContextSchemaVersion: context.schemaVersion,
    contextId: context.contextId,
    contextHash: context.contextHash,
    actionIntent: "watch",
    humanCheckResult: "ready_to_consider",
    userFinalDecision: "Continue research-only observation; no order or portfolio mutation.",
    reviewedAt: null,
    researchReportBinding: binding,
    decisionSnapshotBinding,
    formalDecision: {
      reason: "Exact current report supports continued observation only.",
      horizon: "30 days",
      priceConditions: "Research-only reassessment after fresh evidence; not an order.",
      positionRange: "Research scenario 0-5%; no official position write.",
      mainRisks: "Source drift, incomplete financial coverage, and competitive uncertainty.",
      invalidationConditions: "Exact report, pack, source, or technical binding changes.",
      reviewOn: futureDate(30),
      divergenceReason: null,
      positionBasis: "research_only",
      personalRisk
    },
    idempotencyKey: `hkconnect-${code}-formal-decision`
  };
  const unconfirmed = await rawRequest("POST", `/api/mobile/research/profiles/HK/${record.symbol.slice(3)}/decision-checks`, {
    ...decisionPayload,
    formalDecision: { ...decisionPayload.formalDecision, personalRisk: { ...personalRisk, secondConfirmed: false } },
    idempotencyKey: `hkconnect-${code}-formal-decision-unconfirmed`
  });
  assert.equal(unconfirmed.statusCode, 409);
  const check = await request("POST", `/api/mobile/research/profiles/HK/${record.symbol.slice(3)}/decision-checks`, decisionPayload);
  assert.equal(check.data.formalDecision.availability, "preserved");
  assert.equal(check.data.formalDecision.personalRiskAssessment.requiresOverride, true);
  assert.ok(riskCaptured
    ? check.data.formalDecision.personalRiskAssessment.warnings.length > 0
    : check.data.formalDecision.personalRiskAssessment.unavailableMetrics.length > 0);
  assert.equal(check.data.formalDecision.ownerDecision.personalRisk.secondConfirmed, true);
  assert.equal(check.data.decisionSnapshot.availability, "preserved");
  const trackingInbox = await request("GET", "/api/mobile/research/today/inbox");
  const tracking = trackingInbox.items.find((item) => item.kind === "daily_tracking"
    && item.membership.id === record.membership.id
    && item.reviewEvent?.bindings?.decisionCheckId === check.data.id);
  assert.ok(tracking, `${record.symbol} daily tracking item is missing`);
  const trackingDisposition = await proveImmediateTodayRestore(record.membership, "daily_tracking", `tracking-${code}`);
  const review = await request("POST", `/api/mobile/research/profiles/HK/${record.symbol.slice(3)}/decision-checks/${check.data.id}/reviews`, {
    outcome: "thesis_confirmed",
    outcomeEvidence: "Fresh exact report and source binding remain unchanged in this runtime.",
    reviewNote: "Research-only review; no trading or official asset mutation.",
    reviewedAt: new Date().toISOString(),
    dailyTrackingBinding: trackingDisposition.item.reviewEvent.researchReport.binding,
    idempotencyKey: `hkconnect-${code}-review`
  });
  assert.equal(review.data.decisionCheckId, check.data.id);
  const history = await request("GET", `/api/mobile/research/profiles/HK/${record.symbol.slice(3)}/decision-reviews`);
  const freshCheck = history.checks.find((item) => item.id === check.data.id);
  assert.ok(freshCheck);
  assert.equal(freshCheck.formalDecision.personalRiskAssessment.requiresOverride, true);
  assert.equal(freshCheck.formalDecision.ownerDecision.personalRisk.secondConfirmed, true);
  assert.equal(freshCheck.reviews.some((item) => item.id === review.data.id), true);
  const audit = await pool.query(
    "select after_payload from research_write_audit_events where event_type = 'decision_check_created' and idempotency_key = $1",
    [decisionPayload.idempotencyKey]
  );
  assert.equal(audit.rowCount, 1);
  assert.equal(audit.rows[0].after_payload.formalDecision.ownerDecision.personalRisk.secondConfirmed, true);
  assert.equal(audit.rows[0].after_payload.formalDecision.personalRiskAssessment.requiresOverride, true);
  const resolvedInbox = await request("GET", "/api/mobile/research/today/inbox");
  const resolved = resolvedInbox.items.find((item) => item.membership.id === record.membership.id
    && item.reviewEvent?.bindings?.decisionCheckId === check.data.id);
  assert.equal(resolved?.state, "resolved");
  return {
    symbol: record.symbol,
    membershipId: record.membership.id,
    packId: record.pack.id,
    reportId: record.report.id,
    reportFingerprint: record.report.reportFingerprint,
    decisionCheckId: check.data.id,
    reviewId: review.data.id,
    historyCheckIds: history.checks.map((item) => item.id),
    portfolioContextStatus: portfolioContext.status,
    riskImpactStatus: riskImpact.status,
    personalRiskOverrideAudit: true,
    resolvedToday: true,
    todayDispositionProof: { formalDecisionDue: formalDisposition.proof, dailyTracking: trackingDisposition.proof }
  };
}

async function runMultiStockSimulatorProof(records, quantPortfolioCheckpoint) {
  const simulatorUdid = String(process.env.HK_CONNECT_SIMULATOR_UDID ?? "").trim();
  if (!simulatorUdid) return null;
  assert.match(simulatorUdid, /^[0-9A-F-]{36}$/i);
  const current = records["HK.00175"].membership;
  const compared = records["HK.00700"].membership;
  const issuedAt = Math.floor(Date.now() / 1_000);
  const readOnlyToken = createScopedResearchToken({
    version: 2,
    actorId,
    scopes: ["read"],
    issuedAt,
    expiresAt: issuedAt + 900,
    tokenId: `hkconnect-readonly-${runId}`
  }, authSigningKey);
  await app.close();
  app = await buildServer({
    ...serverConfig(),
    stagingReadOnlyMode: true,
    stagingReadOnlyAuthToken: readOnlyToken
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address === "object" && "port" in address);
  const apiBaseUrl = `http://127.0.0.1:${address.port}`;
  const args = [
    "scripts/fla35-readonly-acceptance.mjs", "--", "/usr/bin/xcodebuild",
    "-scheme", "AnnualRingsGateAAppSmoke",
    "-destination", `platform=iOS Simulator,id=${simulatorUdid}`,
    "test",
    "-only-testing:AnnualRingsGateAAppUITests/GateBResearchUITests/testFLA35FreshOpenDSearchMarketToExactResearchAcceptance"
  ];
  let stdout;
  try {
    ({ stdout } = await execFileAsync(process.execPath, args, {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        API_BASE_URL: apiBaseUrl,
        DATABASE_URL: databaseUrl,
        STAGING_READONLY_MODE: "1",
        STAGING_READONLY_AUTH_HEADER_NAME: "x-internal-token",
        STAGING_READONLY_AUTH_TOKEN: readOnlyToken,
        WRITE_API_TOKEN: "hkconnect-runtime-distinct-write-token",
        FLA35_IOS_LIVE_ACCEPTANCE: "1",
        ANNUAL_RINGS_GATE_A_BASE_URL: apiBaseUrl,
        ANNUAL_RINGS_UI_AUTH_HEADER: "x-internal-token",
        ANNUAL_RINGS_UI_AUTH_TOKEN: readOnlyToken,
        FLA35_EXPECTED_SYMBOL: current.symbol,
        FLA35_EXPECTED_MEMBERSHIP_ID: current.id,
        FLA35_EXPECTED_MEMBERSHIP_VERSION: String(current.version),
        HK_CONNECT_MULTI_STOCK_COMPARISON: "1",
        HK_CONNECT_COMPARE_SYMBOL: compared.symbol,
        HK_CONNECT_COMPARE_MEMBERSHIP_ID: compared.id,
        HK_CONNECT_COMPARE_MEMBERSHIP_VERSION: String(compared.version),
        HK_CONNECT_QUANT_PORTFOLIO: process.env.HK_CONNECT_QUANT_PORTFOLIO === "1"
          && quantPortfolioCheckpoint.status === "RUNTIME_PROVED" ? "1" : "0"
      },
      timeout: 30 * 60_000,
      maxBuffer: 16 * 1024 * 1024
    }));
  } catch (error) {
    if (typeof error?.stderr === "string") process.stderr.write(error.stderr);
    throw error;
  }
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true);
  assert.equal(result.journey.passed, true);
  assert.equal(result.journey.result.requests.every((method) => method === "GET"), true);
  assert.equal(result.database.comparison.ok, true);
  return {
    test: result.journey.result.test,
    result: result.journey.result.result,
    durationInSeconds: result.journey.result.durationInSeconds,
    requestCount: result.journey.result.requests.length,
    allRequestsGet: true,
    databaseTablesUnchanged: Object.keys(result.database.comparison.tables).length,
    currentSymbol: current.symbol,
    comparedSymbol: compared.symbol,
    ownerExplicitSelection: true,
    exactSourceLinksVisible: true,
    stockSwitchClearedStaleComparison: true
  };
}

async function runMultiStockWebProof(records) {
  if (process.env.HK_CONNECT_WEB_ACCEPTANCE !== "1") return null;
  const webPort = Number(process.env.HK_CONNECT_WEB_PORT);
  assert.ok(Number.isInteger(webPort) && webPort > 0 && webPort <= 65_535, "HK_CONNECT_WEB_PORT is required");
  const current = records["HK.00175"].membership;
  const compared = records["HK.00700"].membership;
  const issuedAt = Math.floor(Date.now() / 1_000);
  const readOnlyToken = createScopedResearchToken({
    version: 2, actorId, scopes: ["read"], issuedAt, expiresAt: issuedAt + 30 * 24 * 60 * 60,
    tokenId: `hkconnect-web-readonly-${runId}`
  }, authSigningKey);
  await app.close();
  app = await buildServer({ ...serverConfig(), stagingReadOnlyMode: true, stagingReadOnlyAuthToken: readOnlyToken });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address === "object" && "port" in address);
  const webUrl = `http://127.0.0.1:${webPort}/apps/web/index.html`;
  const child = spawn(process.execPath, ["apps/web/dev-server.mjs"], {
    cwd: repositoryRoot,
    env: { ...process.env, WEB_PORT: String(webPort), WEB_API_BASE_URL: `http://127.0.0.1:${address.port}` },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100 && child.exitCode === null; attempt += 1) {
      try { ready = (await fetch(webUrl)).ok; } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, output);
    console.log(JSON.stringify({
      event: "HK_CONNECT_WEB_ACCEPTANCE_READY", webUrl, readOnlyToken,
      current: membershipSummary(current), compared: membershipSummary(compared)
    }));
    const acknowledgment = await new Promise((resolve) => process.stdin.once("data", (chunk) => resolve(chunk.toString().trim())));
    process.stdin.pause();
    assert.ok(["WEB_PROOF_OK", "WEB_PROOF_SOURCE_REOPEN_EXTERNAL_BLOCKED"].includes(String(acknowledgment)));
    const sourceReopen = acknowledgment === "WEB_PROOF_OK";
    return {
      status: sourceReopen ? "RUNTIME_PROVED" : "RUNTIME_PROVED_WITH_EXTERNAL_SOURCE_REOPEN_BLOCKER",
      currentSymbol: current.symbol, comparedSymbol: compared.symbol,
      ownerExplicitSelection: true, exactReportComparison: true, exactSourceReopen: sourceReopen,
      exactSourceReopenControlVisible: true,
      externalBlocker: sourceReopen ? null : "in_app_browser_blocked_pdf_navigation",
      optionalWorkbench: true, iOSPrerequisite: false, advisoryOnly: true
    };
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    await new Promise((resolve) => child.exitCode === null ? child.once("exit", resolve) : resolve());
  }
}

async function proveQuantPortfolioCheckpoint(records, marketAdmissions) {
  const current = records["HK.00175"].membership;
  const valuationQuery = new URLSearchParams({
    metricCurrency: "HKD", baseMetricPerShare: "1", annualGrowthRate: "0.10",
    horizonYears: "3", terminalMultiple: "10", annualDiscountRate: "0.08",
    netCashPerShare: "0.50", growthRateStep: "0.05", multipleStep: "2",
    maxDrawdownMagnitude: "0.50", maxTurnoverOneWay: "10", minTradeCount: "1"
  });
  const valuation = await request(
    "GET",
    `/api/mobile/research/candidate-memberships/${current.id}/valuation-quant-workbench?${valuationQuery}`
  );
  assert.equal(valuation.status, "available");
  assert.equal(valuation.data.quant.status, "available");
  const decisionUniverse = valuation.data.quant.evidence.identities.hkConnectUniverse;
  assert.equal(decisionUniverse.memberCount, 620);
  assert.equal(decisionUniverse.effectiveDate, "2026-08-14");

  const portfolioResponse = await rawRequest(
    "GET",
    `/api/mobile/research/candidate-memberships/${current.id}/portfolio-lab?scenarioAmount=25000&scenarioAmount=5000`
  );
  if (portfolioResponse.statusCode === 409) {
    assert.equal(portfolioResponse.body.status, "blocked");
    assert.equal(selectedSymbols.every((symbol) =>
      marketAdmissions[symbol].proof.marketState === "CLOSED"
        && marketAdmissions[symbol].proof.quoteStatus === "stale"), true);
    assert.equal(portfolioResponse.body.gaps.some((gap) => /Futu quote\(s\) are stale/.test(gap)), true);
    return {
      status: "EXTERNAL_BLOCKED_MARKET_CLOSED_STALE",
      officialUniverse: decisionUniverse,
      decisionEvidenceId: valuation.data.quant.evidence.evidenceId,
      portfolioEvidenceId: null,
      requiredSymbols: selectedSymbols,
      gaps: portfolioResponse.body.gaps,
      taskOwnedPortfolioSetup: true,
      advisoryOnly: true
    };
  }
  assert.equal(portfolioResponse.statusCode, 200, portfolioResponse.rawPayload.toString("utf8"));
  const portfolio = portfolioResponse.body;
  assert.equal(portfolio.status, "available");
  assert.equal(portfolio.data.quant.coverage.status, "exact");
  assert.deepEqual(portfolio.data.quant.coverage.requiredSymbols, selectedSymbols);
  assert.deepEqual(portfolio.data.quant.coverage.missingSymbols, []);
  assert.ok(portfolio.data.quant.correlations.observationCount >= 120);
  const portfolioUniverse = portfolio.data.quant.evidence.source.hkConnectUniverse;
  assert.deepEqual(portfolioUniverse, decisionUniverse);
  return {
    status: "RUNTIME_PROVED",
    officialUniverse: decisionUniverse,
    decisionEvidenceId: valuation.data.quant.evidence.evidenceId,
    portfolioEvidenceId: portfolio.data.quant.evidence.evidenceId,
    requiredSymbols: portfolio.data.quant.coverage.requiredSymbols,
    observationCount: portfolio.data.quant.correlations.observationCount,
    sourceClassification: portfolio.data.quant.evidence.source.sourceClassification,
    taskOwnedPortfolioSetup: true,
    advisoryOnly: true
  };
}

async function importPdf(membership, source, bytes) {
  const upload = multipart([
    fieldPart("metadata", JSON.stringify({
      membershipVersion: membership.version,
      title: source.title,
      publishedAt: source.publishedAt,
      sourceVersion: source.sourceVersion,
      rightsConfirmed: true,
      idempotencyKey: `hkconnect-document-${membership.id}`
    })),
    filePart("file", `${membership.symbol}.pdf`, "application/pdf", bytes)
  ]);
  const response = await app.inject({
    method: "POST",
    url: `/api/mobile/research/candidate-memberships/${membership.id}/documents`,
    headers: { ...headers, "content-type": upload.contentType },
    payload: upload.body
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}

async function firstTextPage(membershipId, document) {
  for (let pageNumber = 1; pageNumber <= document.pageCount; pageNumber += 1) {
    const page = await request("GET", `/api/mobile/research/candidate-memberships/${membershipId}/documents/${document.id}/pages/${pageNumber}`);
    if (page.normalizedText.trim()) return page;
  }
  assert.fail(`document ${document.id} has no searchable page text`);
}

async function pollTask(membershipId, taskId) {
  for (let attempt = 0; attempt < (aiProviderRuntimeEnabled ? 640 : 80); attempt += 1) {
    const envelope = await request("GET", `/api/mobile/research/candidate-memberships/${membershipId}/deep-research-tasks/${taskId}`);
    if (["failed", "canceled", "ready_to_absorb", "succeeded"].includes(envelope.data.status)) return envelope.data;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail(`deep research task ${taskId} did not reach a terminal state`);
}

async function tableCounts(tables) {
  const result = {};
  for (const table of tables) {
    const relation = await pool.query("select to_regclass($1)::text as relation", [`public.${table}`]);
    result[table] = relation.rows[0]?.relation
      ? Number((await pool.query(`select count(*)::int as count from ${quoteIdent(table)}`)).rows[0].count)
      : 0;
  }
  return result;
}

async function request(method, url, payload, expectedStatus = 200) {
  const response = await rawRequest(method, url, payload);
  assert.equal(response.statusCode, expectedStatus, `${method} ${url}: ${response.rawPayload.toString("utf8")}`);
  return response.body;
}

async function rawRequest(method, url, payload) {
  const response = await app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload }) });
  const rawPayload = Buffer.from(response.rawPayload);
  const contentType = response.headers["content-type"] ?? "";
  let body = rawPayload;
  if (String(contentType).includes("application/json")) body = JSON.parse(rawPayload.toString("utf8"));
  return { statusCode: response.statusCode, headers: response.headers, body, rawPayload };
}

async function externalJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  assert.equal(response.ok, true, `${url} returned ${response.status}`);
  return response.json();
}

async function fetchExternalBytes(url) {
  let failure;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      assert.equal(response.ok, true, `${url} returned ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      failure = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw failure;
}

function membershipSummary(membership) {
  return { id: membership.id, version: membership.version, symbol: membership.symbol, state: membership.state };
}

function serverConfig() {
  return {
    repositoryRoot,
    databaseUrl,
    nodeEnv: "development",
    host: "127.0.0.1",
    port: 0,
    stagingReadOnlyMode: false,
    stagingIdentity: "hkconnect-two-stock-runtime",
    marketProvider: "futu-http",
    futuMarketDataUrl: bridgeUrl,
    futuHistoryKlineUrl: new URL("/history-kline", bridgeUrl).toString(),
    quoteLiveMaxAgeSeconds: 300,
    pinganCurrentPortfolioEnabled: true,
    pinganCurrentMaxAgeSeconds: taskOwnedPortfolioMaxAgeSeconds,
    pinganSnapshotAccountScopesByActor: { [actorId]: "owner-main" },
    quantEvidence: {
      repositoryRoot: taskRoot,
      decision: {
        repositoryPath: decisionQuantManifestPath,
        expectedSha256: decisionQuantManifestSha256,
        maxAgeDays: 3650
      },
      annualPortfolioLab: {
        repositoryPath: portfolioQuantManifestPath,
        expectedSha256: portfolioQuantManifestSha256
      }
    },
    writeAuthToken: null,
    writeAuthHeaderName: "x-internal-token",
    stagingReadOnlyAuthToken: null,
    stagingReadOnlyAuthHeaderName: "x-internal-token",
    authSigningKey,
    authVerificationKeys: [],
    authRevokedTokenIds: new Set(),
    allowLegacyWriteTokenForScopedLanes: false,
    requireWriteAuth: true,
    writeActorId: "hkconnect-runtime-system",
    researchEvidenceAi: aiProviderRuntimeEnabled ? {
      baseUrl: "https://api.deepseek.com/",
      model: "deepseek-flash",
      apiKey: aiApiKey,
      timeoutMs: 60_000
    } : null,
    researchDocumentRawStoreRoot: rawStoreRoot,
    researchDocumentMaxBytes: 30 * 1024 * 1024,
    researchDocumentMaxPages: 300,
    researchDocumentMaxPageTextCharacters: 200_000,
    researchDocumentMaxTotalTextCharacters: 5_000_000
  };
}

async function seedTaskOwnedPortfolio() {
  const symbolHash = createHash("sha256").update(selectedSymbols.join("\n")).digest("hex");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`
      create table broker_import_batches (
        id bigint primary key, status text not null, source text not null,
        created_at timestamptz not null, account_ref text not null
      );
      create table broker_raw_transactions (
        id bigint primary key, batch_id bigint not null references broker_import_batches(id), quantity numeric not null
      );
      create table positions (
        id bigint primary key, market text not null, code text not null, symbol text not null,
        name text, account_ref text not null, currency text, status text not null
      );
      create table broker_trades (
        id bigint primary key, raw_transaction_id bigint not null references broker_raw_transactions(id),
        position_id bigint not null references positions(id)
      );
      create table position_snapshots (
        id bigint primary key, position_id bigint not null references positions(id), quantity numeric not null,
        average_cost numeric, current_weight numeric, max_weight numeric, unrealized_pnl numeric,
        snapshot_as_of timestamptz not null, created_at timestamptz not null
      );
      comment on table broker_import_batches is 'Task-owned local Pingan read-boundary witness; never production truth.';
      comment on table broker_raw_transactions is 'Task-owned local reconciliation witness; never a real transaction fact.';
      comment on table broker_trades is 'Task-owned local reconciliation witness; never a real trade fact.';
      comment on table positions is 'Task-owned local read-boundary witness; never an official position fact.';
      comment on table position_snapshots is 'Task-owned local read-boundary witness; never an official portfolio snapshot.'
    `);
    await client.query(
      `insert into broker_import_batches (id, status, source, created_at, account_ref)
       values (9001, 'approved', 'pingan', now() - interval '30 seconds', 'owner-main')`
    );
    await client.query(
      `insert into positions (id, market, code, symbol, name, account_ref, currency, status)
       values
         (9101, 'HK', '00175', 'HK.00175', 'Geely Automobile', 'owner-main', 'HKD', 'holding'),
         (9102, 'HK', '00700', 'HK.00700', 'Tencent Holdings', 'owner-main', 'HKD', 'holding')`
    );
    await client.query(
      `insert into position_snapshots
       (id, position_id, quantity, average_cost, current_weight, max_weight,
        unrealized_pnl, snapshot_as_of, created_at)
       values
         (9201, 9101, 1000, 18, 0.40, 0.80, 0, now() - interval '45 seconds', now() - interval '30 seconds'),
         (9202, 9102, 100, 600, 0.60, 0.80, 0, now() - interval '45 seconds', now() - interval '30 seconds')`
    );
    await client.query(
      "insert into broker_raw_transactions (id, batch_id, quantity) values (9301, 9001, 1000), (9302, 9001, 100)"
    );
    await client.query(
      "insert into broker_trades (id, raw_transaction_id, position_id) values (9401, 9301, 9101), (9402, 9302, 9102)"
    );
    await client.query(
      `insert into pingan_import_batch_manifests
       (batch_id, account_scope_id, manifest_version, is_full_snapshot,
        expected_position_count, expected_symbols, expected_symbols_sha256,
        expected_position_facts_sha256, expected_batch_imported_at,
        snapshot_group_id, source_as_of, source_fetched_at,
        position_snapshot_ids, created_at)
       select '9001', 'owner-main', '2026-07-19.pingan-full-account-snapshot.v1', true,
              2, $1::text[], $2,
              pingan_import_batch_position_facts_sha256('9001', 'owner-main', array['9201', '9202']),
              (select created_at from broker_import_batches where id = 9001),
              'hkconnect-task-owned-owner-main-9001',
              (select snapshot_as_of from position_snapshots where id = 9201),
              (select max(created_at) from position_snapshots where id in (9201, 9202)),
              array['9201', '9202'], now()`,
      [selectedSymbols, symbolHash]
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function multipart(parts) {
  const boundary = `----hkconnect-${randomUUID()}`;
  const chunks = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n${part.headers}\r\n\r\n`));
    chunks.push(Buffer.isBuffer(part.body) ? part.body : Buffer.from(part.body));
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { contentType: `multipart/form-data; boundary=${boundary}`, body: Buffer.concat(chunks) };
}
function fieldPart(name, value) {
  return {
    headers: `Content-Disposition: form-data; name="${name}"\r\nContent-Type: application/json`,
    body: value
  };
}
function filePart(name, filename, contentType, body) {
  return {
    headers: `Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${contentType}`,
    body
  };
}

function futureDate(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function hongKongDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}

function localDatabaseUrl(name) {
  const host = endpoint.host === "::1" ? "[::1]" : endpoint.host;
  const password = endpoint.password ? `:${encodeURIComponent(endpoint.password)}` : "";
  return `postgresql://${encodeURIComponent(endpoint.user)}${password}@${host}:${endpoint.port}/${name}`;
}

function postgres(command, args, ignoreFailure = false) {
  try {
    execFileSync(command, ["--host", endpoint.host, "--port", endpoint.port, "--username", endpoint.user, ...args], {
      env: commandEnvironment(), stdio: ignoreFailure ? "ignore" : "pipe"
    });
  } catch (error) {
    if (!ignoreFailure) throw error;
  }
}

function commandEnvironment() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "DATABASE_URL" && !key.startsWith("PG")));
  if (endpoint.password) env.PGPASSWORD = endpoint.password;
  delete env.PSQLRC;
  return env;
}

function quoteIdent(value) {
  return `"${value.replaceAll('"', '""')}"`;
}
