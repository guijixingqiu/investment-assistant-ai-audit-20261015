#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import { Pool } from "pg";
import { buildServer } from "../dist/apps/api/src/server.js";
import { createGeelySalesMonitor } from "../dist/apps/api/src/research/geelySalesMonitorRepository.js";
import { readDeepResearchWorkspace } from "../dist/apps/api/src/research/deepResearchReadRepository.js";
import { buildGeelySalesAssessment } from "../dist/packages/contracts/src/geelySalesMonitor.js";
import { ingestGeelySalesMonitor } from "./geely-sales-ingest.mjs";
import { ingestResearchEvent } from "./holding-event-ingest.mjs";
import { runMigrations } from "./migration-runner.mjs";
import { resolveLocalPostgresEndpoint } from "./gate-b-verify.mjs";

const endpoint = resolveLocalPostgresEndpoint(process.env, userInfo().username);
const databaseName = `annual_rings_geely_sales_${Date.now()}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
const databaseUrl = localDatabaseUrl(databaseName);
const token = "geely-sales-local-beta-token";
const headers = { "x-internal-token": token };
const holdingOptions = {
  accountScopeId: null,
  currentPortfolioEnabled: false,
  currentPortfolioMaxAgeSeconds: 3600
};
let app;
let pool;

try {
  postgres("createdb", [databaseName]);
  postgres("psql", ["-d", databaseName, "-f", "tests/fixtures/gate-b-annual-postgres-witness.sql"]);
  pool = new Pool({ connectionString: databaseUrl, max: 2, ssl: false });
  await runMigrations(pool, { log: () => {} });
  const protectedBefore = await protectedPortfolioFacts(pool);
  app = await buildServer(config());
  await app.listen({ host: "127.0.0.1", port: 0 });
  const baseUrl = loopbackOrigin(app);

  const unauthorized = await fetch(new URL("/api/mobile/research/candidate-memberships/1/geely-sales-monitors", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
  assert.equal(unauthorized.status, 401);

  const geelyMembership = await createMembership(baseUrl, "00175", "geely-sales-target");
  const peerMembership = await createMembership(baseUrl, "01211", "geely-sales-peer");
  const secondPeerMembership = await createMembership(baseUrl, "02015", "geely-sales-second-peer");
  await updateProfile(baseUrl, geelyMembership, "00175");
  await updateProfile(baseUrl, peerMembership, "01211");
  await updateProfile(baseUrl, secondPeerMembership, "02015");
  const publishedAt = new Date(Date.now() - 10 * 60_000).toISOString();
  const validUntil = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  const geelyEvent = (await ingestResearchEvent({
    baseUrl,
    token,
    input: eventInput(geelyMembership, "00175", "geely-sales-source", publishedAt, validUntil)
  })).event;
  const peerEvent = (await ingestResearchEvent({
    baseUrl,
    token,
    input: eventInput(peerMembership, "01211", "byd-sales-source", publishedAt, validUntil)
  })).event;
  const secondPeerEvent = (await ingestResearchEvent({
    baseUrl,
    token,
    input: eventInput(secondPeerMembership, "02015", "li-auto-sales-source", publishedAt, validUntil)
  })).event;

  const input = {
    schemaVersion: "2026-07-25.geely-sales-ingest.v1",
    membershipId: geelyMembership.id,
    membershipVersion: geelyMembership.version,
    period: "2026-06",
    observations: observations(geelyEvent.id, peerEvent.id, secondPeerEvent.id),
    ingestionKey: "geely-sales-2026-06-v1"
  };
  const monitor = await ingestGeelySalesMonitor({ baseUrl, token, input });
  assert.equal(monitor.assessment.status, "comparable");
  assert.equal(monitor.assessment.trendConclusionAllowed, true);
  assert.equal(monitor.assessment.movement, "industry_common_up");
  assert.equal(comparison(monitor, "geely_total_sales_mom").percentChange, 11.111111);
  assert.equal(comparison(monitor, "geely_nev_sales_yoy").percentChange, 50);
  assert.equal(ratio(monitor, "geely_nev_share").currentValue, 60);
  assert.equal(ratio(monitor, "geely_export_share").currentValue, 15);
  assert.equal(ratio(monitor, "supplied_peer_set_nev_share").boundary, "bounded supplied peer set; not full-market share");
  assert.equal(monitor.assessment.impacts.grossMargin.signal, "weakens");
  assert.equal(monitor.assessment.impacts.valuation.signal, "unknown");
  const onePeerAssessment = buildGeelySalesAssessment(
    monitor.observations.filter((item) => item.entityId !== "li-auto"),
    input.period
  );
  assert.equal(onePeerAssessment.status, "comparable");
  assert.equal(onePeerAssessment.movement, "unknown");

  const replay = await ingestGeelySalesMonitor({ baseUrl, token, input });
  assert.equal(replay.id, monitor.id);
  assert.equal(replay.runFingerprint, monitor.runFingerprint);
  const reorderedReplay = await ingestGeelySalesMonitor({
    baseUrl,
    token,
    input: { ...input, observations: [...input.observations].reverse() }
  });
  assert.equal(reorderedReplay.id, monitor.id);
  assert.equal(reorderedReplay.runFingerprint, monitor.runFingerprint);

  const impossible = buildGeelySalesAssessment(monitor.observations.map((item) => (
    item.entityId === "geely-auto" && item.period === input.period && item.metric === "sales_volume"
      && item.propulsion === "new_energy" && item.geography === "global"
      ? { ...item, value: 250000 }
      : item
  )), input.period);
  assert.equal(impossible.status, "incomparable");
  assert.equal(impossible.trendConclusionAllowed, false);

  const duplicate = await rawRequest(baseUrl, "POST", `/api/mobile/research/candidate-memberships/${geelyMembership.id}/geely-sales-monitors`, {
    membershipVersion: geelyMembership.version,
    period: input.period,
    observations: input.observations,
    idempotencyKey: "geely-sales-duplicate-input"
  });
  assert.equal(duplicate.status, 409);

  const duplicatedIssuer = await rawRequest(baseUrl, "POST", `/api/mobile/research/candidate-memberships/${geelyMembership.id}/geely-sales-monitors`, {
    membershipVersion: geelyMembership.version,
    period: input.period,
    observations: [
      ...input.observations,
      ...input.observations.filter((item) => item.entityId === "byd").map((item) => ({
        ...item,
        entityId: "byd-duplicate",
        entityName: "BYD duplicate",
        issuerId: "byd-duplicate"
      }))
    ],
    idempotencyKey: "geely-sales-duplicate-issuer"
  });
  assert.equal(duplicatedIssuer.status, 422);
  assert.match(duplicatedIssuer.body.message, /multiple issuer identities/);

  const incomparableInput = {
    ...input,
    ingestionKey: "geely-sales-2026-06-incomparable",
    observations: input.observations.map((item) => (
      item.entityId === "geely-auto" && item.metric === "sales_volume" && item.propulsion === "all"
        && item.geography === "global" && item.periodKind === "month" && item.period === "2025-06"
        ? { ...item, definitionKey: "manufacturer_retail_global_v2" }
        : item
    ))
  };
  const incomparable = await ingestGeelySalesMonitor({ baseUrl, token, input: incomparableInput });
  assert.equal(incomparable.assessment.status, "incomparable");
  assert.equal(incomparable.assessment.trendConclusionAllowed, false);
  assert.equal(incomparable.assessment.movement, "unknown");
  assert.equal(comparison(incomparable, "geely_total_sales_yoy").status, "incomparable");
  assert.equal(incomparable.assessment.blockers.some((item) => item.includes("geely_total_sales_yoy")), true);

  await assert.rejects(
    createGeelySalesMonitor(pool, geelyMembership.id, {
      membershipVersion: geelyMembership.version,
      period: input.period,
      observations: input.observations,
      idempotencyKey: "geely-sales-stale-source"
    }, { actorType: "system", actorId: "geely-sales-local-system" }, holdingOptions, new Date(Date.parse(validUntil) + 1)),
    /eligible source event/
  );
  await assert.rejects(
    createGeelySalesMonitor(pool, geelyMembership.id, {
      membershipVersion: geelyMembership.version,
      period: input.period,
      observations: input.observations,
      idempotencyKey: `${input.ingestionKey}-monitor`
    }, { actorType: "system", actorId: "geely-sales-local-system" }, holdingOptions, new Date(Date.parse(validUntil) + 1)),
    /stale source evidence/
  );
  await assert.rejects(
    readDeepResearchWorkspace(
      pool,
      geelyMembership.id,
      { actorType: "system", actorId: "geely-sales-local-system" },
      new Date(Date.parse(validUntil) + 1)
    ),
    /stale source evidence/
  );

  const workspace = await request(baseUrl, "GET", `/api/mobile/research/candidate-memberships/${geelyMembership.id}/deep-research`);
  assert.equal(workspace.data.latestGeelySalesMonitor.id, incomparable.id);
  await pool.query(
    "update geely_sales_monitor_runs set assessment_payload = jsonb_set(assessment_payload, '{trendConclusionAllowed}', 'true') where id = $1",
    [incomparable.id]
  );
  const tampered = await rawRequest(baseUrl, "GET", `/api/mobile/research/candidate-memberships/${geelyMembership.id}/deep-research`);
  assert.equal(tampered.status, 503);
  assert.equal(tampered.body.data, null);
  await pool.query(
    `update research_write_audit_events
        set after_payload = jsonb_set(after_payload, '{observations,0,value}', '999999')
      where event_type = 'geely_sales_monitor_created' and target_id = $1`,
    [monitor.id]
  );
  const tamperedReplay = await rawRequest(baseUrl, "POST", `/api/mobile/research/candidate-memberships/${geelyMembership.id}/geely-sales-monitors`, {
    membershipVersion: geelyMembership.version,
    period: input.period,
    observations: input.observations,
    idempotencyKey: `${input.ingestionKey}-monitor`
  });
  assert.equal(tamperedReplay.status, 422);
  assert.match(tamperedReplay.body.message, /content-address verification/);

  const pausedMembership = (await request(
    baseUrl,
    "PATCH",
    `/api/mobile/research/candidate-memberships/${geelyMembership.id}/state`,
    { state: "paused", version: geelyMembership.version, idempotencyKey: "geely-sales-version-pause" }
  )).data;
  const resumedMembership = (await request(
    baseUrl,
    "PATCH",
    `/api/mobile/research/candidate-memberships/${geelyMembership.id}/state`,
    { state: "tracked", version: pausedMembership.version, idempotencyKey: "geely-sales-version-resume" }
  )).data;
  const oldTargetVersion = await rawRequest(
    baseUrl,
    "POST",
    `/api/mobile/research/candidate-memberships/${geelyMembership.id}/geely-sales-monitors`,
    {
      membershipVersion: resumedMembership.version,
      period: input.period,
      observations: input.observations,
      idempotencyKey: "geely-sales-old-target-membership-version"
    }
  );
  assert.equal(oldTargetVersion.status, 422);
  assert.match(oldTargetVersion.body.message, /candidate membership version/);

  assert.deepEqual(await protectedPortfolioFacts(pool), protectedBefore);
  const counts = (await pool.query(
    `select
       (select count(*)::int from geely_sales_monitor_runs) as runs,
       (select count(*)::int from research_events) as events,
       (select count(*)::int from research_write_audit_events where event_type = 'geely_sales_monitor_created') as audits`
  )).rows[0];
  assert.deepEqual(counts, { runs: 2, events: 3, audits: 2 });

  console.log(JSON.stringify({
    ok: true,
    comparableRun: { id: monitor.id, version: monitor.runVersion, fingerprint: monitor.runFingerprint },
    incomparableRun: { id: incomparable.id, version: incomparable.runVersion, blockers: incomparable.assessment.blockers },
    failClosed: ["unauthorized", "duplicate_input", "duplicate_issuer", "single_peer_movement", "old_target_membership_version", "impossible_ratio", "incomparable_definition", "stale_source", "stale_read", "stale_replay", "table_tamper", "audit_replay_tamper"],
    protectedPortfolioFactsUnchanged: true,
    counts
  }, null, 2));
} finally {
  if (app) await app.close().catch(() => {});
  if (pool) await pool.end().catch(() => {});
  postgres("dropdb", ["--if-exists", "--force", databaseName], true);
}

function observations(geelyEventId, peerEventId, secondPeerEventId) {
  const rows = [];
  const add = (eventId, entityId, entityName, entityRole, entityLevel, issuerId, periodKind, period, metric, propulsion, geography, value) => {
    rows.push({
      eventId, entityId, entityName, entityRole, entityLevel, issuerId, periodKind, period, metric,
      propulsion, geography, channel: "wholesale",
      unit: metric === "sales_volume" ? "vehicles" : "CNY_per_vehicle",
      definitionKey: "manufacturer_wholesale_global_v1",
      value
    });
  };
  for (const [period, total, nev, exports] of [
    ["2026-06", 200000, 120000, 30000],
    ["2026-05", 180000, 100000, 25000],
    ["2025-06", 150000, 80000, 20000]
  ]) {
    add(geelyEventId, "geely-auto", "Geely Auto", "target", "issuer", "geely-auto", "month", period, "sales_volume", "all", "global", total);
    add(geelyEventId, "geely-auto", "Geely Auto", "target", "issuer", "geely-auto", "month", period, "sales_volume", "new_energy", "global", nev);
    add(geelyEventId, "geely-auto", "Geely Auto", "target", "issuer", "geely-auto", "month", period, "sales_volume", "all", "export", exports);
  }
  for (const [period, total, nev, exports] of [["2026-06", 1000000, 600000, 150000], ["2025-06", 800000, 400000, 100000]]) {
    add(geelyEventId, "geely-auto", "Geely Auto", "target", "issuer", "geely-auto", "year_to_date", period, "sales_volume", "all", "global", total);
    add(geelyEventId, "geely-auto", "Geely Auto", "target", "issuer", "geely-auto", "year_to_date", period, "sales_volume", "new_energy", "global", nev);
    add(geelyEventId, "geely-auto", "Geely Auto", "target", "issuer", "geely-auto", "year_to_date", period, "sales_volume", "all", "export", exports);
  }
  for (const [period, value] of [["2026-06", 150000], ["2026-05", 155000], ["2025-06", 160000]]) {
    add(geelyEventId, "geely-auto", "Geely Auto", "target", "issuer", "geely-auto", "month", period, "average_transaction_price", "all", "china", value);
  }
  for (const [period, value] of [["2026-06", 40000], ["2025-06", 25000]]) {
    add(geelyEventId, "zeekr", "Zeekr", "target", "brand", "geely-auto", "month", period, "sales_volume", "all", "global", value);
  }
  for (const [period, value] of [["2026-06", 350000], ["2026-05", 330000], ["2025-06", 300000]]) {
    add(peerEventId, "byd", "BYD", "peer", "issuer", "byd", "month", period, "sales_volume", "new_energy", "global", value);
  }
  for (const [period, value] of [["2026-06", 52000], ["2026-05", 50000], ["2025-06", 42000]]) {
    add(secondPeerEventId, "li-auto", "Li Auto", "peer", "issuer", "li-auto", "month", period, "sales_volume", "new_energy", "global", value);
  }
  return rows;
}

function eventInput(membership, code, ingestionKey, publishedAt, validUntil) {
  return {
    schemaVersion: "2026-07-25.holding-event-ingest.v1",
    membershipId: membership.id,
    membershipVersion: membership.version,
    market: "HK",
    code,
    ingestionKey,
    eventKind: "announcement",
    coverageScope: "research_stock",
    material: {
      title: `${code} supplied comparable sales table`,
      contentText: "User-supplied issuer sales rows with explicit monthly and cumulative definitions for deterministic Local Beta comparison.",
      sourceType: "issuer_sales_supplied_text",
      sourceUrl: `https://example.invalid/${code}/sales`,
      publishedAt,
      claimType: "issuer_statement",
      verificationStatus: "verified",
      rightsStatus: "authorized_public",
      sourceVersion: `${code}-sales-v1`,
      validUntil,
      summary: "Supplied issuer sales table for the Geely comparison pilot.",
      variableName: "new_energy_vehicle_sales",
      stance: "support",
      reliability: 5,
      materiality: 5,
      isRead: false
    }
  };
}

async function createMembership(baseUrl, code, idempotencyKey) {
  return (await request(baseUrl, "POST", "/api/mobile/research/candidate-memberships", {
    market: "HK", code, initialState: "tracked", idempotencyKey
  }, 201)).data;
}

async function updateProfile(baseUrl, membership, code) {
  await request(baseUrl, "PUT", `/api/mobile/research/profiles/HK/${code}`, {
    membershipId: membership.id,
    membershipVersion: membership.version,
    currentView: "Comparable issuer sales require exact definitions.",
    currentThesis: "Sales evidence changes require user review.",
    keyVariables: ["new_energy_vehicle_sales"],
    catalysts: [],
    evidenceGaps: [],
    idempotencyKey: `geely-sales-profile-${code}`
  });
}

function comparison(monitor, id) { return monitor.assessment.comparisons.find((item) => item.id === id); }
function ratio(monitor, id) { return monitor.assessment.ratios.find((item) => item.id === id); }
async function request(baseUrl, method, path, payload, expectedStatus = 200) { const response = await rawRequest(baseUrl, method, path, payload); assert.equal(response.status, expectedStatus, `${method} ${path}: ${JSON.stringify(response.body)}`); return response.body; }
async function rawRequest(baseUrl, method, path, payload) { const response = await fetch(new URL(path, baseUrl), { method, headers: { ...headers, ...(payload === undefined ? {} : { "content-type": "application/json" }) }, body: payload === undefined ? undefined : JSON.stringify(payload) }); return { status: response.status, body: await response.json() }; }

async function protectedPortfolioFacts(client) {
  return (await client.query(
    `select
       (select count(*)::int from broker_import_batches) as batches,
       (select count(*)::int from broker_raw_transactions) as raw_transactions,
       (select coalesce(sum(quantity), 0)::text from broker_raw_transactions) as raw_quantity,
       (select count(*)::int from broker_trades) as trades,
       (select count(*)::int from positions) as positions,
       (select count(*)::int from position_snapshots) as snapshots,
       (select coalesce(sum(quantity), 0)::text from position_snapshots) as snapshot_quantity`
  )).rows[0];
}

function config() {
  return {
    databaseUrl, nodeEnv: "development", host: "127.0.0.1", port: 0,
    stagingReadOnlyMode: false, stagingIdentity: "geely-sales-local-beta",
    marketProvider: "unavailable", futuMarketDataUrl: null, quoteLiveMaxAgeSeconds: 300,
    pinganCurrentPortfolioEnabled: false, pinganCurrentMaxAgeSeconds: 300, quantEvidence: null,
    writeAuthToken: token, writeAuthHeaderName: "x-internal-token",
    stagingReadOnlyAuthToken: null, stagingReadOnlyAuthHeaderName: "",
    authSigningKey: null, authVerificationKeys: [], authRevokedTokenIds: new Set(),
    allowLegacyWriteTokenForScopedLanes: true, requireWriteAuth: true, writeActorId: "geely-sales-local-system"
  };
}

function loopbackOrigin(server) { const address = server.server.address(); assert(address && typeof address === "object"); return `http://127.0.0.1:${address.port}`; }
function localDatabaseUrl(name) { const host = endpoint.host === "::1" ? "[::1]" : endpoint.host; const password = endpoint.password ? `:${encodeURIComponent(endpoint.password)}` : ""; return `postgresql://${encodeURIComponent(endpoint.user)}${password}@${host}:${endpoint.port}/${name}`; }
function postgres(command, args, ignoreFailure = false) { try { execFileSync(command, ["--host", endpoint.host, "--port", endpoint.port, "--username", endpoint.user, ...args], { env: commandEnvironment(), stdio: ignoreFailure ? "ignore" : "pipe" }); } catch (error) { if (!ignoreFailure) throw error; } }
function commandEnvironment() { const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "DATABASE_URL" && !key.startsWith("PG"))); if (endpoint.password) env.PGPASSWORD = endpoint.password; delete env.PSQLRC; return env; }
