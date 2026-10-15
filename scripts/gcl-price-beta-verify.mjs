#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import { Pool } from "pg";
import { buildServer } from "../dist/apps/api/src/server.js";
import { createGclPvPriceMonitor } from "../dist/apps/api/src/research/gclPvPriceMonitorRepository.js";
import { readDeepResearchWorkspace } from "../dist/apps/api/src/research/deepResearchReadRepository.js";
import { buildGclPvPriceAssessment } from "../dist/packages/contracts/src/gclPvPriceMonitor.js";
import { ingestGclPvPriceMonitor } from "./gcl-price-ingest.mjs";
import { ingestResearchEvent } from "./holding-event-ingest.mjs";
import { runMigrations } from "./migration-runner.mjs";
import { resolveLocalPostgresEndpoint } from "./gate-b-verify.mjs";

const endpoint = resolveLocalPostgresEndpoint(process.env, userInfo().username);
const databaseName = `annual_rings_gcl_price_${Date.now()}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
const databaseUrl = localDatabaseUrl(databaseName);
const token = "gcl-price-local-beta-token";
const headers = { "x-internal-token": token };
const holdingOptions = {
  accountScopeId: "owner-main",
  currentPortfolioEnabled: true,
  currentPortfolioMaxAgeSeconds: 3600
};
let app;
let pool;

try {
  postgres("createdb", [databaseName]);
  postgres("psql", ["-d", databaseName, "-f", "tests/fixtures/gate-b-annual-postgres-witness.sql"]);
  pool = new Pool({ connectionString: databaseUrl, max: 2, ssl: false });
  await runMigrations(pool, { log: () => {} });
  await seedPinganManifest(pool);
  const protectedBefore = await protectedPortfolioFacts(pool);
  app = await buildServer(config());
  await app.listen({ host: "127.0.0.1", port: 0 });
  const baseUrl = loopbackOrigin(app);

  const unauthorized = await fetch(new URL("/api/mobile/research/candidate-memberships/1/gcl-pv-price-monitors", baseUrl), {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}"
  });
  assert.equal(unauthorized.status, 401);

  const membership = await createMembership(baseUrl);
  const variables = ["polysilicon_price", "wafer_price", "cell_price", "module_price", "inventory", "utilization", "capacity", "company_cost", "impairment"];
  await updateProfile(baseUrl, membership, variables);
  const publishedAt = new Date(Date.now() - 10 * 60_000).toISOString();
  const validUntil = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  const events = new Map();
  for (const variable of variables.filter((item) => item !== "impairment")) {
    const result = await ingestResearchEvent({
      baseUrl,
      token,
      input: eventInput(membership, variable, publishedAt, validUntil)
    });
    assert.equal(result.event.coverageScope, "current_holding");
    assert.equal(result.event.holdingBinding.accountScopeId, "owner-main");
    events.set(variable, result.event);
  }

  const input = {
    schemaVersion: "2026-07-25.gcl-price-ingest.v1",
    membershipId: membership.id,
    membershipVersion: membership.version,
    period: "2026-07-18",
    referencePeriod: "2026-07-11",
    priceObservations: prices(events),
    contextObservations: contexts(events),
    ingestionKey: "gcl-pv-price-2026-07-18-v1"
  };
  let invalidFetches = 0;
  await assert.rejects(
    ingestGclPvPriceMonitor({
      baseUrl,
      token,
      input: {
        ...input,
        priceObservations: input.priceObservations.map((item, index) => index === 0
          ? { ...item, unit: "CNY_per_watt", conversionFactorToCnyPerWatt: 0.003 }
          : item)
      },
      fetchImpl: async () => { invalidFetches += 1; throw new Error("invalid input must not reach HTTP"); }
    }),
    /CNY_per_watt conversion factor must equal 1/
  );
  assert.equal(invalidFetches, 0);

  const monitor = await ingestGclPvPriceMonitor({ baseUrl, token, input });
  assert.equal(monitor.assessment.status, "comparable");
  assert.equal(monitor.assessment.trendConclusionAllowed, true);
  assert.equal(monitor.assessment.spreadConclusionAllowed, true);
  assert.equal(trend(monitor, "polysilicon_price_trend").percentChange, -16.666667);
  assert.equal(spread(monitor, "wafer_minus_polysilicon").currentCnyPerWatt, 0.1);
  assert.equal(spread(monitor, "module_minus_cell").changeCnyPerWatt, -0.01);
  assert.equal(context(monitor, "inventory").percentChange, -20);
  assert.equal(context(monitor, "utilization").changePercentagePoints, -10);
  assert.equal(context(monitor, "impairment").status, "missing");
  assert.equal(monitor.assessment.impacts.cost.signal, "supports");
  assert.equal(monitor.assessment.impacts.impairment.signal, "unknown");
  assert.equal(monitor.priceObservations.every((item) => item.sourceEvent.rightsStatus === "authorized_public" && item.sourceEvent.revision === 1), true);
  assert.equal(monitor.priceObservations.every((item) => item.sourceEvent.coverageScope === "current_holding" && item.sourceEvent.holdingBinding.snapshotId), true);

  const replay = await ingestGclPvPriceMonitor({ baseUrl, token, input });
  assert.equal(replay.id, monitor.id);
  assert.equal(replay.runFingerprint, monitor.runFingerprint);
  const reordered = await ingestGclPvPriceMonitor({
    baseUrl,
    token,
    input: {
      ...input,
      priceObservations: [...input.priceObservations].reverse(),
      contextObservations: [...input.contextObservations].reverse()
    }
  });
  assert.equal(reordered.id, monitor.id);
  assert.equal(reordered.runFingerprint, monitor.runFingerprint);

  assert.deepEqual(await protectedPortfolioFacts(pool), protectedBefore);

  const duplicate = await rawRequest(baseUrl, "POST", `/api/mobile/research/candidate-memberships/${membership.id}/gcl-pv-price-monitors`, {
    membershipVersion: membership.version,
    period: input.period,
    referencePeriod: input.referencePeriod,
    priceObservations: input.priceObservations,
    contextObservations: input.contextObservations,
    idempotencyKey: "gcl-price-duplicate-input"
  });
  assert.equal(duplicate.status, 409);

  const badSource = await rawRequest(baseUrl, "POST", `/api/mobile/research/candidate-memberships/${membership.id}/gcl-pv-price-monitors`, {
    membershipVersion: membership.version,
    period: input.period,
    referencePeriod: input.referencePeriod,
    priceObservations: input.priceObservations.map((item) => item.stage === "polysilicon" ? { ...item, eventId: events.get("wafer_price").id } : item),
    contextObservations: input.contextObservations,
    idempotencyKey: "gcl-price-wrong-source-variable"
  });
  assert.equal(badSource.status, 422);
  assert.match(badSource.body.message, /eligible HK\.03800 source event/);

  const incomparableInput = {
    ...input,
    ingestionKey: "gcl-pv-price-2026-07-18-incomparable",
    priceObservations: input.priceObservations.map((item) => item.stage === "wafer" && item.period === input.referencePeriod
      ? { ...item, productSpecification: "N-type 210 mm wafer" }
      : item)
  };
  const incomparable = await ingestGclPvPriceMonitor({ baseUrl, token, input: incomparableInput });
  assert.equal(incomparable.assessment.status, "incomparable");
  assert.equal(incomparable.assessment.trendConclusionAllowed, false);
  assert.equal(incomparable.assessment.spreadConclusionAllowed, false);
  assert.equal(trend(incomparable, "wafer_price_trend").status, "incomparable");
  assert.equal(spread(incomparable, "wafer_minus_polysilicon").status, "incomparable");

  const missing = buildGclPvPriceAssessment(
    monitor.priceObservations.filter((item) => !(item.stage === "module" && item.period === input.referencePeriod)),
    [],
    input.period,
    input.referencePeriod
  );
  assert.equal(missing.status, "insufficient");
  assert.equal(missing.trendConclusionAllowed, false);
  assert.equal(missing.spreadConclusionAllowed, false);
  assert.equal(missing.context.every((item) => item.status === "missing"), true);

  await assert.rejects(
    createGclPvPriceMonitor(pool, membership.id, {
      membershipVersion: membership.version,
      period: input.period,
      referencePeriod: input.referencePeriod,
      priceObservations: input.priceObservations,
      contextObservations: input.contextObservations,
      idempotencyKey: "gcl-price-stale-source"
    }, { actorType: "system", actorId: "gcl-price-local-system" }, holdingOptions, new Date(Date.parse(validUntil) + 1)),
    /eligible HK\.03800 source event/
  );
  await assert.rejects(
    createGclPvPriceMonitor(pool, membership.id, {
      membershipVersion: membership.version,
      period: input.period,
      referencePeriod: input.referencePeriod,
      priceObservations: input.priceObservations,
      contextObservations: input.contextObservations,
      idempotencyKey: `${input.ingestionKey}-monitor`
    }, { actorType: "system", actorId: "gcl-price-local-system" }, holdingOptions, new Date(Date.parse(validUntil) + 1)),
    /stale source evidence/
  );
  await assert.rejects(
    readDeepResearchWorkspace(
      pool,
      membership.id,
      { actorType: "system", actorId: "gcl-price-local-system" },
      new Date(Date.parse(validUntil) + 1),
      holdingOptions
    ),
    /stale source evidence/
  );

  const workspace = await request(baseUrl, "GET", `/api/mobile/research/candidate-memberships/${membership.id}/deep-research`);
  assert.equal(workspace.data.latestGclPvPriceMonitor.id, incomparable.id);
  await pool.query(
    "update gcl_pv_price_monitor_runs set assessment_payload = jsonb_set(assessment_payload, '{trendConclusionAllowed}', 'true') where id = $1",
    [incomparable.id]
  );
  const tampered = await rawRequest(baseUrl, "GET", `/api/mobile/research/candidate-memberships/${membership.id}/deep-research`);
  assert.equal(tampered.status, 503);
  assert.equal(tampered.body.data, null);
  await pool.query(
    "update gcl_pv_price_monitor_runs set assessment_payload = $2::jsonb where id = $1",
    [incomparable.id, JSON.stringify(incomparable.assessment)]
  );
  await pool.query(
    `update research_write_audit_events
        set after_payload = jsonb_set(after_payload, '{priceObservations,0,value}', '999999')
      where event_type = 'gcl_pv_price_monitor_created' and target_id = $1`,
    [monitor.id]
  );
  const tamperedReplay = await rawRequest(baseUrl, "POST", `/api/mobile/research/candidate-memberships/${membership.id}/gcl-pv-price-monitors`, {
    membershipVersion: membership.version,
    period: input.period,
    referencePeriod: input.referencePeriod,
    priceObservations: input.priceObservations,
    contextObservations: input.contextObservations,
    idempotencyKey: `${input.ingestionKey}-monitor`
  });
  assert.equal(tamperedReplay.status, 422);
  assert.match(tamperedReplay.body.message, /content-address verification/);

  const replacementInput = eventInput(membership, "module_price", publishedAt, validUntil);
  const replacement = await ingestResearchEvent({
    baseUrl,
    token,
    input: {
      ...replacementInput,
      ingestionKey: "gcl-module-price-replacement",
      material: {
        ...replacementInput.material,
        title: "Replacement module-price series",
        contentText: "Authorized corrected module-price source version for revision fail-closed verification.",
        sourceVersion: "gcl-module_price-v2",
        replacesMaterialId: events.get("module_price").source.materialId,
        summary: "Replacement module-price source."
      }
    }
  });
  const replacedRead = await rawRequest(baseUrl, "GET", `/api/mobile/research/candidate-memberships/${membership.id}/deep-research`);
  assert.equal(replacedRead.status, 503);
  assert.equal(replacedRead.body.data, null);
  const replacedReplay = await rawRequest(baseUrl, "POST", `/api/mobile/research/candidate-memberships/${membership.id}/gcl-pv-price-monitors`, {
    membershipVersion: membership.version,
    period: incomparableInput.period,
    referencePeriod: incomparableInput.referencePeriod,
    priceObservations: incomparableInput.priceObservations,
    contextObservations: incomparableInput.contextObservations,
    idempotencyKey: `${incomparableInput.ingestionKey}-monitor`
  });
  assert.equal(replacedReplay.status, 422);
  assert.match(replacedReplay.body.message, /stale or replaced/);

  const refreshedInput = {
    ...input,
    ingestionKey: "gcl-pv-price-2026-07-18-refreshed",
    priceObservations: input.priceObservations.map((item) =>
      item.stage === "module" ? { ...item, eventId: replacement.event.id } : item)
  };
  const refreshed = await ingestGclPvPriceMonitor({ baseUrl, token, input: refreshedInput });
  assert.equal(refreshed.priceObservations.filter((item) => item.stage === "module")
    .every((item) => item.sourceEvent.revision === 2), true);
  assert.deepEqual(await protectedPortfolioFacts(pool), protectedBefore);
  const counts = (await pool.query(
    `select
       (select count(*)::int from gcl_pv_price_monitor_runs) as runs,
       (select count(*)::int from research_events) as events,
       (select count(*)::int from research_write_audit_events where event_type = 'gcl_pv_price_monitor_created') as audits`
  )).rows[0];
  assert.deepEqual(counts, { runs: 3, events: 9, audits: 3 });

  await appendPinganSnapshot(pool);
  const supersededSnapshotFacts = await protectedPortfolioFacts(pool);
  const supersededRead = await rawRequest(
    baseUrl, "GET", `/api/mobile/research/candidate-memberships/${membership.id}/deep-research`
  );
  assert.equal(supersededRead.status, 503);
  assert.equal(supersededRead.body.data, null);
  for (const idempotencyKey of [
    `${refreshedInput.ingestionKey}-monitor`,
    "gcl-price-superseded-holding-binding"
  ]) {
    const response = await rawRequest(baseUrl, "POST", `/api/mobile/research/candidate-memberships/${membership.id}/gcl-pv-price-monitors`, {
      membershipVersion: membership.version,
      period: refreshedInput.period,
      referencePeriod: refreshedInput.referencePeriod,
      priceObservations: refreshedInput.priceObservations,
      contextObservations: refreshedInput.contextObservations,
      idempotencyKey
    });
    assert.equal(response.status, 422);
    assert.match(response.body.message, /exact current account snapshot/);
  }
  assert.deepEqual(await protectedPortfolioFacts(pool), supersededSnapshotFacts);

  console.log(JSON.stringify({
    ok: true,
    comparableRun: { id: monitor.id, version: monitor.runVersion, fingerprint: monitor.runFingerprint },
    incomparableRun: { id: incomparable.id, blockers: incomparable.assessment.blockers },
    failClosed: ["invalid_unit", "unauthorized", "duplicate_input", "wrong_source_variable", "incomparable_specification", "missing_context", "superseded_holding_read", "superseded_holding_replay", "superseded_holding_create", "stale_source", "stale_read", "stale_replay", "table_tamper", "audit_replay_tamper", "replaced_revision"],
    protectedPortfolioFactsUnchanged: true,
    counts
  }, null, 2));
} finally {
  if (app) await app.close().catch(() => {});
  if (pool) await pool.end().catch(() => {});
  postgres("dropdb", ["--if-exists", "--force", databaseName], true);
}

function prices(events) {
  const definitions = {
    polysilicon: { unit: "CNY_per_kg", factor: 0.003, values: [50, 60] },
    wafer: { unit: "CNY_per_piece", factor: 0.1, values: [2.5, 2.8] },
    cell: { unit: "CNY_per_watt", factor: 1, values: [0.32, 0.35] },
    module: { unit: "CNY_per_watt", factor: 1, values: [0.68, 0.72] }
  };
  const rows = [];
  for (const [stage, definition] of Object.entries(definitions)) {
    for (const [index, period] of ["2026-07-18", "2026-07-11"].entries()) {
      rows.push({
        eventId: events.get(`${stage}_price`).id,
        stage,
        period,
        productSpecification: stage === "polysilicon" ? "N-type dense polysilicon" : stage === "wafer" ? "N-type 182 mm wafer" : stage === "cell" ? "N-type 182 mm cell" : "N-type 182 mm module",
        unit: definition.unit,
        currency: "CNY",
        value: definition.values[index],
        conversionFactorToCnyPerWatt: definition.factor,
        normalizationBasisKey: "n_type_182mm_chain_equivalent_v1",
        normalizationRule: `${stage} supplied physical conversion to CNY/W v1`,
        definitionKey: `${stage}_authorized_weekly_cash_price_v1`
      });
    }
  }
  return rows;
}

function contexts(events) {
  const definitions = {
    inventory: { unit: "metric_tonnes", currency: null, values: [120000, 150000] },
    utilization: { unit: "percent", currency: null, values: [70, 80] },
    capacity: { unit: "metric_tonnes_per_year", currency: null, values: [500000, 500000] },
    company_cost: { unit: "CNY_per_kg", currency: "CNY", values: [35, 40] }
  };
  const rows = [];
  for (const [metric, definition] of Object.entries(definitions)) {
    for (const [index, period] of ["2026-07-18", "2026-07-11"].entries()) {
      rows.push({
        eventId: events.get(metric).id,
        metric,
        period,
        productSpecification: metric === "company_cost" ? "GCL granular silicon cash cost disclosure" : `supplied ${metric} scope`,
        unit: definition.unit,
        currency: definition.currency,
        value: definition.values[index],
        definitionKey: `${metric}_authorized_period_end_v1`
      });
    }
  }
  return rows;
}

function eventInput(membership, variableName, publishedAt, validUntil) {
  return {
    schemaVersion: "2026-07-25.holding-event-ingest.v1",
    membershipId: membership.id,
    membershipVersion: membership.version,
    market: "HK",
    code: "03800",
    ingestionKey: `gcl-price-source-${variableName}`,
    eventKind: "announcement",
    coverageScope: "current_holding",
    material: {
      title: `GCL supplied ${variableName} series`,
      contentText: `User-supplied authorized ${variableName} rows with explicit specification, unit, period, normalization and revision.`,
      sourceType: "authorized_supplied_pv_series",
      sourceUrl: `https://example.invalid/03800/${variableName}`,
      publishedAt,
      claimType: "third_party_statement",
      verificationStatus: "verified",
      rightsStatus: "authorized_public",
      sourceVersion: `gcl-${variableName}-v1`,
      validUntil,
      summary: `Authorized ${variableName} source for the GCL Local Beta pilot.`,
      variableName,
      stance: ["inventory", "utilization", "company_cost"].includes(variableName) ? "support" : "neutral",
      reliability: 5,
      materiality: 5,
      isRead: false
    }
  };
}

async function createMembership(baseUrl) {
  return (await request(baseUrl, "POST", "/api/mobile/research/candidate-memberships", {
    market: "HK", code: "03800", initialState: "tracked", idempotencyKey: "gcl-price-membership"
  }, 201)).data;
}

async function updateProfile(baseUrl, membership, keyVariables) {
  await request(baseUrl, "PUT", "/api/mobile/research/profiles/HK/03800", {
    membershipId: membership.id,
    membershipVersion: membership.version,
    currentView: "PV prices require exact specification and unit normalization.",
    currentThesis: "Price-chain evidence changes require explicit user review.",
    keyVariables,
    catalysts: [],
    evidenceGaps: ["impairment"],
    idempotencyKey: "gcl-price-profile"
  });
}

function trend(monitor, id) { return monitor.assessment.priceTrends.find((item) => item.id === id); }
function spread(monitor, id) { return monitor.assessment.spreads.find((item) => item.id === id); }
function context(monitor, id) { return monitor.assessment.context.find((item) => item.id === id); }
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

async function seedPinganManifest(client) {
  await client.query(
    `insert into pingan_import_batch_manifests
      (batch_id, account_scope_id, manifest_version, is_full_snapshot,
       expected_position_count, expected_symbols, expected_symbols_sha256,
       expected_position_facts_sha256, expected_batch_imported_at,
       snapshot_group_id, source_as_of, source_fetched_at,
       position_snapshot_ids, created_at)
     select '9001', 'owner-main',
            '2026-07-19.pingan-full-account-snapshot.v1', true,
            2, array['HK.03800', 'HK.09926'],
            '4a7162214d76faa26994e43ea380f1761fb0ca31fa7209157e46126212c48642',
            pingan_import_batch_position_facts_sha256('9001', 'owner-main', array['9201', '9202']),
            (select created_at from broker_import_batches where id = 9001),
            'gcl-price-owner-main-9001',
            (select snapshot_as_of from position_snapshots where id = 9201),
            (select max(created_at) from position_snapshots where id in (9201, 9202)),
            array['9201', '9202'],
            (select max(created_at) from position_snapshots where id in (9201, 9202))`
  );
}

async function appendPinganSnapshot(client) {
  await client.query(
    `insert into broker_import_batches (id, status, source, created_at, account_ref)
     values (9002, 'approved', 'pingan', now() - interval '1 minute', 'owner-main');
     insert into position_snapshots
       (id, position_id, quantity, average_cost, current_weight, max_weight, unrealized_pnl, snapshot_as_of, created_at)
     values
       (9203, 9101, 20000, 2.25, 0.49, 0.80, 5100, now() - interval '90 seconds', now() - interval '1 minute'),
       (9204, 9102, 1000, 45.00, 0.51, 0.80, 4900, now() - interval '90 seconds', now() - interval '1 minute');
     insert into broker_raw_transactions (id, batch_id, quantity) values (9303, 9002, 20000), (9304, 9002, 1000);
     insert into broker_trades (id, raw_transaction_id, position_id) values (9403, 9303, 9101), (9404, 9304, 9102);
     insert into pingan_import_batch_manifests
       (batch_id, account_scope_id, manifest_version, is_full_snapshot,
        expected_position_count, expected_symbols, expected_symbols_sha256,
        expected_position_facts_sha256, expected_batch_imported_at,
        snapshot_group_id, source_as_of, source_fetched_at, position_snapshot_ids, created_at)
     select '9002', 'owner-main', '2026-07-19.pingan-full-account-snapshot.v1', true,
            2, array['HK.03800', 'HK.09926'],
            '4a7162214d76faa26994e43ea380f1761fb0ca31fa7209157e46126212c48642',
            pingan_import_batch_position_facts_sha256('9002', 'owner-main', array['9203', '9204']),
            (select created_at from broker_import_batches where id = 9002),
            'gcl-price-owner-main-9002',
            (select snapshot_as_of from position_snapshots where id = 9203),
            (select max(created_at) from position_snapshots where id in (9203, 9204)),
            array['9203', '9204'],
            now()`
  );
}

function config() {
  return {
    databaseUrl, nodeEnv: "development", host: "127.0.0.1", port: 0,
    stagingReadOnlyMode: false, stagingIdentity: "gcl-price-local-beta",
    marketProvider: "unavailable", futuMarketDataUrl: null, quoteLiveMaxAgeSeconds: 300,
    pinganCurrentPortfolioEnabled: true, pinganCurrentMaxAgeSeconds: 3600, quantEvidence: null,
    writeAuthToken: token, writeAuthHeaderName: "x-internal-token",
    stagingReadOnlyAuthToken: null, stagingReadOnlyAuthHeaderName: "",
    authSigningKey: null, authVerificationKeys: [], authRevokedTokenIds: new Set(),
    allowLegacyWriteTokenForScopedLanes: true, requireWriteAuth: true, writeActorId: "gcl-price-local-system"
  };
}

function loopbackOrigin(server) { const address = server.server.address(); assert(address && typeof address === "object"); return `http://127.0.0.1:${address.port}`; }
function localDatabaseUrl(name) { const host = endpoint.host === "::1" ? "[::1]" : endpoint.host; const password = endpoint.password ? `:${encodeURIComponent(endpoint.password)}` : ""; return `postgresql://${encodeURIComponent(endpoint.user)}${password}@${host}:${endpoint.port}/${name}`; }
function postgres(command, args, ignoreFailure = false) { try { execFileSync(command, ["--host", endpoint.host, "--port", endpoint.port, "--username", endpoint.user, ...args], { env: commandEnvironment(), stdio: ignoreFailure ? "ignore" : "pipe" }); } catch (error) { if (!ignoreFailure) throw error; } }
function commandEnvironment() { const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "DATABASE_URL" && !key.startsWith("PG"))); if (endpoint.password) env.PGPASSWORD = endpoint.password; delete env.PSQLRC; return env; }
