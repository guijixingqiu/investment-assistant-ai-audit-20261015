#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import { Pool } from "pg";
import { buildServer } from "../dist/apps/api/src/server.js";
import { ingestResearchEvent } from "./holding-event-ingest.mjs";
import { runMigrations } from "./migration-runner.mjs";
import { resolveLocalPostgresEndpoint } from "./gate-b-verify.mjs";

const endpoint = resolveLocalPostgresEndpoint(process.env, userInfo().username);
const databaseName = `annual_rings_holding_event_${Date.now()}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
const databaseUrl = localDatabaseUrl(databaseName);
const token = "holding-event-local-beta-token";
const headers = { "x-internal-token": token };
let app;
let disabledApp;
let pool;

try {
  postgres("createdb", [databaseName]);
  postgres("psql", ["-d", databaseName, "-f", "tests/fixtures/gate-b-annual-postgres-witness.sql"]);
  pool = new Pool({ connectionString: databaseUrl, max: 2, ssl: false });
  await runMigrations(pool, { log: () => {} });
  await seedPinganManifest(pool);
  const protectedBefore = await protectedPortfolioFacts(pool);
  app = await buildServer(config(true));
  await app.listen({ host: "127.0.0.1", port: 0 });
  const baseUrl = loopbackOrigin(app);

  const unauthorized = await fetch(new URL("/api/mobile/research/candidate-memberships/1/research-events", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
  assert.equal(unauthorized.status, 401);
  const unauthorizedToday = await fetch(new URL("/api/mobile/research/candidate-memberships/1/today", baseUrl));
  assert.equal(unauthorizedToday.status, 401);
  assert.deepEqual((await unauthorizedToday.json()).items, []);

  const gclMembership = await createMembership(baseUrl, "03800", "holding-event-gcl-membership");
  await updateProfile(baseUrl, gclMembership, "03800", ["polysilicon_price"]);
  const geelyMembership = await createMembership(baseUrl, "00175", "holding-event-geely-membership");
  await updateProfile(baseUrl, geelyMembership, "00175", ["new_energy_vehicle_sales"]);
  const lowPriorityHoldingMembership = await createMembership(baseUrl, "09926", "holding-event-low-priority-membership");
  await updateProfile(baseUrl, lowPriorityHoldingMembership, "09926", ["earnings"]);

  const publishedAt = new Date(Date.now() - 10 * 60_000).toISOString();
  const validUntil = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  const gclInput = eventInput({
    membership: gclMembership,
    code: "03800",
    ingestionKey: "holding-event-gcl-v1",
    eventKind: "announcement",
    coverageScope: "current_holding",
    variableName: "polysilicon_price",
    publishedAt,
    validUntil,
    title: "GCL polysilicon price disclosure",
    contentText: "The supplied issuer text reports a polysilicon price development for the stated period.",
    sourceVersion: "gcl-2026-07-25-v1",
    stance: "support",
    reliability: 5,
    materiality: 5
  });
  let invalidInputFetches = 0;
  await assert.rejects(
    ingestResearchEvent({
      baseUrl,
      token,
      input: { ...gclInput, eventKind: "memo" },
      fetchImpl: async () => {
        invalidInputFetches += 1;
        throw new Error("invalid input must not reach HTTP");
      }
    }),
    /eventKind is invalid/
  );
  assert.equal(invalidInputFetches, 0);
  const gcl = await ingestResearchEvent({ baseUrl, token, input: gclInput });
  assert.equal(gcl.event.coverageScope, "current_holding");
  assert.equal(gcl.event.importance, "high");
  assert.equal(gcl.event.hypothesisImpact, "supports");
  assert.equal(gcl.event.holdingBinding.accountScopeId, "owner-main");
  assert.equal(gcl.event.holdingBinding.sourceBatchId, "9001");
  const replay = await ingestResearchEvent({ baseUrl, token, input: gclInput });
  assert.equal(replay.material.id, gcl.material.id);
  assert.equal(replay.event.id, gcl.event.id);
  assert.equal(replay.event.eventFingerprint, gcl.event.eventFingerprint);

  const geely = await ingestResearchEvent({
    baseUrl,
    token,
    input: eventInput({
      membership: geelyMembership,
      code: "00175",
      ingestionKey: "holding-event-geely-v1",
      eventKind: "news",
      coverageScope: "research_stock",
      variableName: "new_energy_vehicle_sales",
      publishedAt,
      validUntil,
      title: "Geely comparable sales news input",
      contentText: "The supplied news text raises a question about comparable new-energy vehicle sales.",
      sourceVersion: "geely-2026-07-25-v1",
      stance: "refute",
      reliability: null,
      materiality: 5
    })
  });
  assert.equal(geely.event.importance, "unknown");
  assert.equal(geely.event.hypothesisImpact, "weakens");
  assert.equal(geely.event.holdingBinding, null);
  const lowPriorityHolding = await ingestResearchEvent({
    baseUrl,
    token,
    input: eventInput({
      membership: lowPriorityHoldingMembership,
      code: "09926",
      ingestionKey: "holding-event-low-priority-v1",
      eventKind: "news",
      coverageScope: "current_holding",
      variableName: "earnings",
      publishedAt,
      validUntil,
      title: "Current-holding low-priority supplied news",
      contentText: "The supplied text is traceable but below the threshold for a separate Today alert.",
      sourceVersion: "holding-low-priority-2026-07-25-v1",
      stance: "neutral",
      reliability: 1,
      materiality: 1
    })
  });
  assert.equal(lowPriorityHolding.event.importance, "low");
  assert(lowPriorityHolding.event.holdingBinding);

  const gclWorkspace = await request(baseUrl, "GET", `/api/mobile/research/candidate-memberships/${gclMembership.id}/deep-research`);
  const geelyWorkspace = await request(baseUrl, "GET", `/api/mobile/research/candidate-memberships/${geelyMembership.id}/deep-research`);
  assert.deepEqual(gclWorkspace.data.events, [gcl.event]);
  assert.deepEqual(geelyWorkspace.data.events, [geely.event]);
  const gclToday = await request(baseUrl, "GET", `/api/mobile/research/candidate-memberships/${gclMembership.id}/today`);
  const holdingItem = gclToday.items.find((item) => item.category === "holding_logic_change");
  assert(holdingItem);
  assert.equal(holdingItem.bindings.eventRefs[0].eventId, gcl.event.id);
  assert.deepEqual(holdingItem.bindings.holdingSnapshotRefs, [gcl.event.holdingBinding]);
  assert.equal(gclToday.quality.sourceHealth.status, "revision_mismatch");
  const preReplacementSourceHealthId = gclToday.quality.sourceHealth.id;
  const geelyToday = await request(baseUrl, "GET", `/api/mobile/research/candidate-memberships/${geelyMembership.id}/today`);
  assert.deepEqual(geelyToday.items.map((item) => item.category), ["user_action"]);
  const lowPriorityToday = await request(baseUrl, "GET", `/api/mobile/research/candidate-memberships/${lowPriorityHoldingMembership.id}/today`);
  assert.deepEqual(lowPriorityToday.items.map((item) => item.category), ["user_action"]);
  assert.deepEqual(lowPriorityToday.items[0].bindings.holdingSnapshotRefs, [lowPriorityHolding.event.holdingBinding]);

  const duplicate = await rawRequest(baseUrl, "POST", `/api/mobile/research/candidate-memberships/${gclMembership.id}/research-events`, {
    membershipVersion: gclMembership.version,
    materialId: gcl.material.id,
    eventKind: "announcement",
    coverageScope: "current_holding",
    idempotencyKey: "holding-event-gcl-duplicate"
  });
  assert.equal(duplicate.status, 409);

  const rightsMaterial = await createMaterial(baseUrl, geelyMembership, "00175", {
    publishedAt,
    validUntil,
    sourceVersion: "geely-rights-unknown-v1",
    contentText: "Rights for this supplied news text are unknown.",
    variableName: "new_energy_vehicle_sales",
    rightsStatus: "unknown"
  }, "holding-event-rights-material");
  await expectEventFailure(baseUrl, geelyMembership, rightsMaterial.id, "news", "research_stock", "holding-event-rights-event", /rights/, 422);

  const staleMaterial = await createMaterial(baseUrl, geelyMembership, "00175", {
    publishedAt: new Date(Date.now() - 48 * 60 * 60_000).toISOString(),
    validUntil: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
    sourceVersion: "geely-stale-v1",
    contentText: "This supplied event text is outside its declared validity window.",
    variableName: "new_energy_vehicle_sales"
  }, "holding-event-stale-material");
  await expectEventFailure(baseUrl, geelyMembership, staleMaterial.id, "news", "research_stock", "holding-event-stale-event", /stale/, 422);

  const conflictMaterial = await createMaterial(baseUrl, geelyMembership, "00175", {
    publishedAt,
    validUntil,
    sourceVersion: "geely-conflict-v1",
    contentText: "Two supplied source versions conflict on the stated comparable sales definition.",
    variableName: "new_energy_vehicle_sales",
    verificationStatus: "conflict"
  }, "holding-event-conflict-material");
  await expectEventFailure(baseUrl, geelyMembership, conflictMaterial.id, "news", "research_stock", "holding-event-conflict-event", /not verified/, 422);

  const nonHoldingMaterial = await createMaterial(baseUrl, geelyMembership, "00175", {
    publishedAt,
    validUntil,
    sourceVersion: "geely-nonholding-v1",
    contentText: "This supplied issuer event is valid research evidence but Geely is not in the current Pingan snapshot.",
    variableName: "new_energy_vehicle_sales"
  }, "holding-event-nonholding-material");
  await expectEventFailure(baseUrl, geelyMembership, nonHoldingMaterial.id, "announcement", "current_holding", "holding-event-nonholding-event", /not present/, 422);

  const disabledMaterial = await createMaterial(baseUrl, gclMembership, "03800", {
    publishedAt,
    validUntil,
    sourceVersion: "gcl-source-disabled-v1",
    contentText: "This supplied issuer event cannot become a holding event while the current source is disabled.",
    variableName: "polysilicon_price"
  }, "holding-event-source-disabled-material");
  disabledApp = await buildServer(config(false));
  await disabledApp.listen({ host: "127.0.0.1", port: 0 });
  await expectEventFailure(loopbackOrigin(disabledApp), gclMembership, disabledMaterial.id, "announcement", "current_holding", "holding-event-source-disabled-event", /enabled account-scoped/, 422);

  const protectedAfter = await protectedPortfolioFacts(pool);
  assert.deepEqual(protectedAfter, protectedBefore, "event ingestion must not mutate broker, cash, fee, trade, position, or snapshot facts");

  await appendPinganSnapshot(pool);
  const snapshotMismatch = await rawRequest(baseUrl, "GET", `/api/mobile/research/candidate-memberships/${gclMembership.id}/today`);
  assert.equal(snapshotMismatch.status, 409);
  assert.deepEqual(snapshotMismatch.body.items, []);
  assert.match(snapshotMismatch.body.message, /exact current account snapshot/);
  assert.equal(snapshotMismatch.body.quality.sourceHealth.status, "conflict");
  assert.equal(snapshotMismatch.body.quality.sourceHealth.issueCodes.includes("holding_snapshot_conflict"), true);
  assert.notEqual(snapshotMismatch.body.quality.sourceHealth.id, preReplacementSourceHealthId);
  const lowPrioritySnapshotMismatch = await rawRequest(
    baseUrl, "GET", `/api/mobile/research/candidate-memberships/${lowPriorityHoldingMembership.id}/today`
  );
  assert.equal(lowPrioritySnapshotMismatch.status, 409);
  assert.deepEqual(lowPrioritySnapshotMismatch.body.items, []);
  const deepResearchSnapshotMismatch = await rawRequest(
    baseUrl, "GET", `/api/mobile/research/candidate-memberships/${gclMembership.id}/deep-research`
  );
  assert.equal(deepResearchSnapshotMismatch.status, 503);
  assert.equal(deepResearchSnapshotMismatch.body.data, null);

  const replacement = await ingestResearchEvent({
    baseUrl,
    token,
    input: {
      ...gclInput,
      ingestionKey: "holding-event-gcl-v2",
      material: {
        ...gclInput.material,
        contentText: "The corrected supplied issuer text reports the current polysilicon price development.",
        sourceVersion: "gcl-2026-07-25-v2",
        replacesMaterialId: gcl.material.id
      }
    }
  });
  assert.equal(replacement.event.holdingBinding.sourceBatchId, "9002");
  const recoveredWorkspace = await request(
    baseUrl, "GET", `/api/mobile/research/candidate-memberships/${gclMembership.id}/deep-research`
  );
  assert.equal(recoveredWorkspace.data.events.find((event) => event.id === gcl.event.id).source.revisionState, "replaced");
  assert.equal(recoveredWorkspace.data.events.find((event) => event.id === replacement.event.id).source.revisionState, "current");
  const recoveredToday = await request(baseUrl, "GET", `/api/mobile/research/candidate-memberships/${gclMembership.id}/today`);
  assert.equal(recoveredToday.items.some((item) =>
    item.bindings.eventRefs.some((event) => event.eventId === replacement.event.id)), true);

  const counts = (await pool.query(
    `select
       (select count(*)::int from research_events) as events,
       (select count(*)::int from research_materials) as materials,
       (select count(*)::int from research_write_audit_events where event_type = 'research_event_created') as event_audits`
  )).rows[0];
  assert.deepEqual(counts, { events: 4, materials: 9, event_audits: 4 });

  await pool.query("update research_events set key_variable = 'tampered' where id = $1", [gcl.event.id]);
  const tampered = await rawRequest(baseUrl, "GET", `/api/mobile/research/candidate-memberships/${gclMembership.id}/deep-research`);
  assert.equal(tampered.status, 503);
  assert.equal(tampered.body.data, null);

  console.log(JSON.stringify({
    ok: true,
    holdingEvent: {
      id: gcl.event.id,
      version: gcl.event.eventVersion,
      fingerprint: gcl.event.eventFingerprint,
      snapshotId: gcl.event.holdingBinding.snapshotId
    },
    researchStockEvent: {
      id: geely.event.id,
      version: geely.event.eventVersion,
      fingerprint: geely.event.eventFingerprint,
      importance: geely.event.importance
    },
    failClosed: ["invalid_event_before_write", "unauthorized", "duplicate", "rights", "stale", "conflict", "non_current_holding", "source_disabled", "snapshot_today", "snapshot_deep_research", "snapshot_recovery", "tamper"],
    protectedPortfolioFactsUnchanged: true,
    counts
  }, null, 2));
} finally {
  if (disabledApp) await disabledApp.close().catch(() => {});
  if (app) await app.close().catch(() => {});
  if (pool) await pool.end().catch(() => {});
  postgres("dropdb", ["--if-exists", "--force", databaseName], true);
}

function config(pinganCurrentPortfolioEnabled) {
  return {
    databaseUrl,
    nodeEnv: "development",
    host: "127.0.0.1",
    port: 0,
    stagingReadOnlyMode: false,
    stagingIdentity: "holding-event-local-beta",
    marketProvider: "unavailable",
    futuMarketDataUrl: null,
    quoteLiveMaxAgeSeconds: 300,
    pinganCurrentPortfolioEnabled,
    pinganCurrentMaxAgeSeconds: 3600,
    quantEvidence: null,
    writeAuthToken: token,
    writeAuthHeaderName: "x-internal-token",
    stagingReadOnlyAuthToken: null,
    stagingReadOnlyAuthHeaderName: "",
    authSigningKey: null,
    authVerificationKeys: [],
    authRevokedTokenIds: new Set(),
    allowLegacyWriteTokenForScopedLanes: true,
    requireWriteAuth: true,
    writeActorId: "holding-event-local-system"
  };
}

async function createMembership(baseUrl, code, idempotencyKey) {
  const envelope = await request(baseUrl, "POST", "/api/mobile/research/candidate-memberships", {
    market: "HK",
    code,
    initialState: "tracked",
    idempotencyKey
  }, 201);
  return envelope.data;
}

async function updateProfile(baseUrl, membership, code, keyVariables) {
  await request(baseUrl, "PUT", `/api/mobile/research/profiles/HK/${code}`, {
    membershipId: membership.id,
    membershipVersion: membership.version,
    currentView: "Local Beta research-only view.",
    currentThesis: "Evidence changes must be reviewed by the user.",
    keyVariables,
    catalysts: [],
    evidenceGaps: [],
    idempotencyKey: `holding-event-profile-${code}`
  });
}

function eventInput(input) {
  return {
    schemaVersion: "2026-07-25.holding-event-ingest.v1",
    membershipId: input.membership.id,
    membershipVersion: input.membership.version,
    market: "HK",
    code: input.code,
    ingestionKey: input.ingestionKey,
    eventKind: input.eventKind,
    coverageScope: input.coverageScope,
    material: {
      title: input.title,
      contentText: input.contentText,
      sourceType: "issuer_or_news_supplied_text",
      sourceUrl: `https://example.invalid/${input.code}/${input.sourceVersion}`,
      publishedAt: input.publishedAt,
      claimType: input.eventKind === "announcement" ? "issuer_statement" : "third_party_statement",
      verificationStatus: "verified",
      rightsStatus: "authorized_public",
      sourceVersion: input.sourceVersion,
      validUntil: input.validUntil,
      summary: input.contentText,
      variableName: input.variableName,
      stance: input.stance,
      reliability: input.reliability,
      materiality: input.materiality,
      isRead: false
    }
  };
}

async function createMaterial(baseUrl, membership, code, overrides, idempotencyKey) {
  const body = {
    membershipId: membership.id,
    membershipVersion: membership.version,
    title: "Fail-closed source input",
    contentText: overrides.contentText,
    sourceType: "supplied_text",
    sourceUrl: `https://example.invalid/${code}/${overrides.sourceVersion}`,
    publishedAt: overrides.publishedAt,
    claimType: "third_party_statement",
    verificationStatus: overrides.verificationStatus ?? "verified",
    rightsStatus: overrides.rightsStatus ?? "authorized_public",
    sourceVersion: overrides.sourceVersion,
    validUntil: overrides.validUntil,
    summary: overrides.contentText,
    variableName: overrides.variableName,
    stance: "neutral",
    reliability: 4,
    materiality: 4,
    isRead: false,
    idempotencyKey
  };
  return (await request(baseUrl, "POST", `/api/mobile/research/profiles/HK/${code}/materials`, body)).data;
}

async function expectEventFailure(baseUrl, membership, materialId, eventKind, coverageScope, idempotencyKey, pattern, status) {
  const response = await rawRequest(baseUrl, "POST", `/api/mobile/research/candidate-memberships/${membership.id}/research-events`, {
    membershipVersion: membership.version,
    materialId,
    eventKind,
    coverageScope,
    idempotencyKey
  });
  assert.equal(response.status, status, JSON.stringify(response.body));
  assert.match([response.body.message, ...(response.body.failures ?? [])].join("\n"), pattern);
}

async function request(baseUrl, method, path, payload, expectedStatus = 200) {
  const response = await rawRequest(baseUrl, method, path, payload);
  assert.equal(response.status, expectedStatus, `${method} ${path}: ${JSON.stringify(response.body)}`);
  return response.body;
}

async function rawRequest(baseUrl, method, path, payload) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: { ...headers, ...(payload === undefined ? {} : { "content-type": "application/json" }) },
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });
  return { status: response.status, body: await response.json() };
}

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

async function appendPinganSnapshot(client) {
  await client.query("begin");
  try {
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
              'holding-event-owner-main-9002',
              (select snapshot_as_of from position_snapshots where id = 9203),
              (select max(created_at) from position_snapshots where id in (9203, 9204)),
              array['9203', '9204'],
              now()`
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
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
            'holding-event-owner-main-9001',
            (select snapshot_as_of from position_snapshots where id = 9201),
            (select max(created_at) from position_snapshots where id in (9201, 9202)),
            array['9201', '9202'],
            (select max(created_at) from position_snapshots where id in (9201, 9202))`
  );
}

function loopbackOrigin(server) {
  const address = server.server.address();
  assert(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

function localDatabaseUrl(name) {
  const host = endpoint.host === "::1" ? "[::1]" : endpoint.host;
  const password = endpoint.password ? `:${encodeURIComponent(endpoint.password)}` : "";
  return `postgresql://${encodeURIComponent(endpoint.user)}${password}@${host}:${endpoint.port}/${name}`;
}

function postgres(command, args, ignoreFailure = false) {
  try {
    execFileSync(command, ["--host", endpoint.host, "--port", endpoint.port, "--username", endpoint.user, ...args], {
      env: commandEnvironment(),
      stdio: ignoreFailure ? "ignore" : "pipe"
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
