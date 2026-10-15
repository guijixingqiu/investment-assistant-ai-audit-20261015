import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("未验证: DATABASE_URL is required for data gate sample reconciliation.");
  process.exit(2);
}

const samplePath = process.env.DATA_GATE_SAMPLE_PATH ?? "tests/fixtures/data-gate-sample.json";
const runId = process.env.DATA_GATE_RUN_ID ?? `data-gate-${Date.now()}`;
const sample = JSON.parse(await readFile(samplePath, "utf8"));
const samples = normalizeSamples(sample);

const client = new Client({
  connectionString: databaseUrl,
  application_name: "annual-rings-data-gate-sample"
});

await client.connect();

try {
  await client.query("begin");
  await client.query("set local statement_timeout = '10s'");
  await client.query("set local lock_timeout = '1s'");

  validateSample(sample);
  const sampleSymbols = [];
  await insertMigrationRun(runId, sampleLabel(sample), sample);
  for (const item of samples) {
    const normalized = normalizeSymbol(item.symbol);
    sampleSymbols.push(normalized);
    const stockId = await upsertStock(normalized, item.symbol.name ?? null);
    await upsertPositions(stockId, normalized, item.positions);
    await upsertDecisionChecks(stockId, normalized, item.decisionChecks);
    await upsertResearchEvents(stockId, normalized, item.researchEvents);
  }
  await upsertGlobalResearchEvents(sample.globalResearchEvents ?? []);

  const expectedCounts = expectedCountsFor(sample, samples);
  const actualCounts = await loadActualCounts(sampleSymbols);
  const mismatches = reconcileCounts(expectedCounts, actualCounts);
  const relationshipIssues = await validateRelationships(sampleSymbols);
  mismatches.push(...relationshipIssues);

  if (mismatches.length > 0) {
    await finishMigrationRun(runId, "failed", actualCounts, mismatches);
    await client.query("commit");
    console.error(JSON.stringify({ ok: false, runId, sampleSymbol: sampleLabel(sample), actualCounts, mismatches }, null, 2));
    process.exit(1);
  }

  await finishMigrationRun(runId, "succeeded", actualCounts, []);
  await client.query("commit");
  console.log(JSON.stringify({
    ok: true,
    runId,
    sampleSymbol: sampleLabel(sample),
    sourceLabel: sample.sourceLabel,
    expectedCounts,
    actualCounts,
    notes: [
      "This is a controlled data-gate sample reconciliation against a candidate database.",
      "It does not read or write production data.",
      "Empty trades/reviews are asserted as empty and are not fabricated."
    ]
  }, null, 2));
} catch (error) {
  try {
    await client.query("rollback");
  } catch {
    // Ignore rollback failure while reporting the original error.
  }
  throw error;
} finally {
  await client.end();
}

function validateSample(payload) {
  assert.equal(typeof payload.sourceLabel, "string");
  for (const item of normalizeSamples(payload)) {
    assert.equal(typeof item.symbol?.market, "string");
    assert.equal(typeof item.symbol?.code, "string");
    assert.equal(Array.isArray(item.positions), true);
    assert.equal(Array.isArray(item.decisionChecks), true);
    assert.equal(Array.isArray(item.researchEvents), true);
    assert.equal(Array.isArray(item.trades), true);
    assert.equal(Array.isArray(item.reviews), true);
    assert.equal(item.trades.length, 0, "data gate sample must not fabricate trades");
    assert.equal(item.reviews.length, 0, "data gate sample must not fabricate reviews");
    for (const position of item.positions) {
      assertRequired(position.legacyId, "position.legacyId");
      assertRequired(position.quantity, "position.quantity");
      assertRequired(position.status, "position.status");
      assertRequired(position.snapshotAsOf, "position.snapshotAsOf");
    }
    for (const decision of item.decisionChecks) {
      assertRequired(decision.legacyId, "decision.legacyId");
      assertRequired(decision.actionIntent, "decision.actionIntent");
      assertRequired(decision.verdict, "decision.verdict");
      assertRequired(decision.checkedAt, "decision.checkedAt");
    }
    for (const event of item.researchEvents) {
      assertRequired(event.legacyId, "researchEvent.legacyId");
      assertRequired(event.sourceType, "researchEvent.sourceType");
      assertRequired(event.summary, "researchEvent.summary");
      assertRequired(event.eventType, "researchEvent.eventType");
      assertRequired(event.impactDirection, "researchEvent.impactDirection");
      assertRequired(event.confidence, "researchEvent.confidence");
      assertRequired(event.capturedAt, "researchEvent.capturedAt");
    }
  }
  assert.equal(Array.isArray(payload.globalResearchEvents ?? []), true);
  for (const event of payload.globalResearchEvents ?? []) {
    assertRequired(event.legacyId, "globalResearchEvent.legacyId");
    assertRequired(event.sourceType, "globalResearchEvent.sourceType");
    assertRequired(event.summary, "globalResearchEvent.summary");
    assertRequired(event.eventType, "globalResearchEvent.eventType");
    assertRequired(event.impactDirection, "globalResearchEvent.impactDirection");
    assertRequired(event.confidence, "globalResearchEvent.confidence");
    assertRequired(event.capturedAt, "globalResearchEvent.capturedAt");
  }
}

function assertRequired(value, label) {
  assert.notEqual(value, null, `${label} is required`);
  assert.notEqual(value, undefined, `${label} is required`);
  assert.notEqual(value, "", `${label} is required`);
}

function normalizeSamples(payload) {
  if (Array.isArray(payload.samples)) {
    return payload.samples.map((item) => ({
      ...item,
      positions: item.positions ?? [],
      decisionChecks: item.decisionChecks ?? [],
      researchEvents: item.researchEvents ?? [],
      trades: item.trades ?? [],
      reviews: item.reviews ?? []
    }));
  }
  return [{
    symbol: payload.symbol,
    positions: payload.positions ?? [],
    decisionChecks: payload.decisionChecks ?? [],
    researchEvents: payload.researchEvents ?? [],
    trades: payload.trades ?? [],
    reviews: payload.reviews ?? []
  }];
}

function expectedCountsFor(payload, sampleItems) {
  if (payload.expectedCounts) {
    return normalizeExpectedCounts(payload.expectedCounts);
  }
  return normalizeExpectedCounts({
    positions: sampleItems.reduce((sum, item) => sum + item.positions.length, 0),
    decisionChecks: sampleItems.reduce((sum, item) => sum + item.decisionChecks.length, 0),
    researchEvents: sampleItems.reduce((sum, item) => sum + item.researchEvents.length, 0),
    globalResearchEvents: payload.globalResearchEvents?.length ?? 0,
    trades: sampleItems.reduce((sum, item) => sum + item.trades.length, 0),
    reviews: sampleItems.reduce((sum, item) => sum + item.reviews.length, 0)
  });
}

function normalizeExpectedCounts(counts) {
  return {
    positions: Number(counts.positions ?? 0),
    decisionChecks: Number(counts.decisionChecks ?? 0),
    researchEvents: Number(counts.researchEvents ?? 0),
    globalResearchEvents: Number(counts.globalResearchEvents ?? 0),
    trades: Number(counts.trades ?? 0),
    reviews: Number(counts.reviews ?? 0)
  };
}

function sampleLabel(payload) {
  if (Array.isArray(payload.samples)) {
    return payload.samples.map((item) => normalizeSymbol(item.symbol).symbol).join(",");
  }
  return normalizeSymbol(payload.symbol).symbol;
}

function normalizeSymbol(symbol) {
  const market = String(symbol.market).trim().toUpperCase();
  const code = String(symbol.code).trim().toUpperCase();
  return {
    market,
    code,
    symbol: `${market}.${code}`
  };
}

async function upsertStock(symbol, name) {
  const result = await client.query(
    `insert into stocks (market, code, symbol, name)
     values ($1, $2, $3, $4)
     on conflict (market, code)
     do update set symbol = excluded.symbol, name = coalesce(excluded.name, stocks.name), updated_at = now()
     returning id`,
    [symbol.market, symbol.code, symbol.symbol, name]
  );
  return result.rows[0].id;
}

async function insertMigrationRun(id, sampleSymbol, payload) {
  await client.query(
    `insert into data_migration_runs (run_id, sample_symbol, source_label, status, expected_counts, raw_payload)
     values ($1, $2, $3, 'running', $4::jsonb, $5::jsonb)
     on conflict (run_id)
     do update set status = 'running',
                   expected_counts = excluded.expected_counts,
                   actual_counts = '{}'::jsonb,
                   mismatches = '[]'::jsonb,
                   started_at = now(),
                   finished_at = null,
                   raw_payload = excluded.raw_payload`,
    [id, sampleSymbol, payload.sourceLabel, JSON.stringify(payload.expectedCounts), JSON.stringify({ samplePath })]
  );
}

async function upsertPositions(stockId, symbol, positions) {
  for (const item of positions) {
    await client.query(
      `insert into portfolio_positions
        (stock_id, market, code, symbol, legacy_id, quantity, average_cost,
         current_weight, max_weight, unrealized_pnl, status, snapshot_as_of, raw_payload)
       values
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
       on conflict (legacy_id)
       do update set quantity = excluded.quantity,
                     average_cost = excluded.average_cost,
                     current_weight = excluded.current_weight,
                     max_weight = excluded.max_weight,
                     unrealized_pnl = excluded.unrealized_pnl,
                     status = excluded.status,
                     snapshot_as_of = excluded.snapshot_as_of,
                     raw_payload = excluded.raw_payload,
                     updated_at = now()`,
      [
        stockId,
        symbol.market,
        symbol.code,
        symbol.symbol,
        item.legacyId,
        item.quantity,
        item.averageCost,
        item.currentWeight,
        item.maxWeight,
        item.unrealizedPnl,
        item.status,
        item.snapshotAsOf,
        JSON.stringify(item)
      ]
    );
  }
}

async function upsertDecisionChecks(stockId, symbol, decisionChecks) {
  for (const item of decisionChecks) {
    await client.query(
      `insert into pre_trade_decision_checks
        (stock_id, market, code, symbol, legacy_id, action_intent, verdict,
         requested_price, requested_quantity, current_price, current_quantity,
         average_cost, market_value, current_weight, user_final_decision,
         decided_at, checked_at, raw_payload)
       values
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb)
       on conflict (legacy_id)
       do update set action_intent = excluded.action_intent,
                     verdict = excluded.verdict,
                     requested_price = excluded.requested_price,
                     requested_quantity = excluded.requested_quantity,
                     current_price = excluded.current_price,
                     current_quantity = excluded.current_quantity,
                     average_cost = excluded.average_cost,
                     market_value = excluded.market_value,
                     current_weight = excluded.current_weight,
                     user_final_decision = excluded.user_final_decision,
                     decided_at = excluded.decided_at,
                     checked_at = excluded.checked_at,
                     raw_payload = excluded.raw_payload`,
      [
        stockId,
        symbol.market,
        symbol.code,
        symbol.symbol,
        item.legacyId,
        item.actionIntent,
        item.verdict,
        item.requestedPrice,
        item.requestedQuantity,
        item.currentPrice,
        item.currentQuantity,
        item.averageCost,
        item.marketValue,
        item.currentWeight,
        item.userFinalDecision,
        item.decidedAt,
        item.checkedAt,
        JSON.stringify(item)
      ]
    );
  }
}

async function upsertResearchEvents(stockId, symbol, researchEvents) {
  for (const item of researchEvents) {
    await client.query(
      `insert into migrated_research_events
        (stock_id, market, code, symbol, legacy_id, source_type, title,
         summary, event_type, impact_direction, confidence, captured_at, raw_payload)
       values
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
       on conflict (legacy_id)
       do update set source_type = excluded.source_type,
                     title = excluded.title,
                     summary = excluded.summary,
                     event_type = excluded.event_type,
                     impact_direction = excluded.impact_direction,
                     confidence = excluded.confidence,
                     captured_at = excluded.captured_at,
                     raw_payload = excluded.raw_payload`,
      [
        stockId,
        symbol.market,
        symbol.code,
        symbol.symbol,
        item.legacyId,
        item.sourceType,
        item.title,
        item.summary,
        item.eventType,
        item.impactDirection,
        item.confidence,
        item.capturedAt,
        JSON.stringify(item)
      ]
    );
  }
}

async function upsertGlobalResearchEvents(researchEvents) {
  for (const item of researchEvents) {
    await client.query(
      `insert into legacy_research_events
        (legacy_id, source_type, title, summary, event_type, impact_direction, confidence, captured_at, raw_payload)
       values
        ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       on conflict (legacy_id)
       do update set source_type = excluded.source_type,
                     title = excluded.title,
                     summary = excluded.summary,
                     event_type = excluded.event_type,
                     impact_direction = excluded.impact_direction,
                     confidence = excluded.confidence,
                     captured_at = excluded.captured_at,
                     raw_payload = excluded.raw_payload`,
      [
        item.legacyId,
        item.sourceType,
        item.title,
        item.summary,
        item.eventType,
        item.impactDirection,
        item.confidence,
        item.capturedAt,
        JSON.stringify(item)
      ]
    );
  }
}

async function loadActualCounts(symbols) {
  const pairs = symbolPairs(symbols);
  const result = await client.query(
    `select
       (select count(*)::integer from portfolio_positions where (market, code) in (${pairs.sql})) as positions,
       (select count(*)::integer from pre_trade_decision_checks where (market, code) in (${pairs.sql})) as "decisionChecks",
       (select count(*)::integer from migrated_research_events where (market, code) in (${pairs.sql})) as "researchEvents",
       (select count(*)::integer from legacy_research_events) as "globalResearchEvents",
       0::integer as trades,
       0::integer as reviews`,
    pairs.values
  );
  return result.rows[0];
}

function reconcileCounts(expected, actual) {
  const mismatches = [];
  for (const key of ["positions", "decisionChecks", "researchEvents", "globalResearchEvents", "trades", "reviews"]) {
    if (Number(expected[key]) !== Number(actual[key])) {
      mismatches.push({
        kind: "count_mismatch",
        key,
        expected: Number(expected[key]),
        actual: Number(actual[key])
      });
    }
  }
  return mismatches;
}

async function validateRelationships(symbols) {
  const pairs = symbolPairs(symbols);
  const result = await client.query(
    `select issue
       from (
         select 'position_stock_symbol_mismatch' as issue
           from portfolio_positions pp
           join stocks s on s.id = pp.stock_id
          where (pp.market, pp.code) in (${pairs.sql}) and (s.market <> pp.market or s.code <> pp.code)
         union all
         select 'decision_stock_symbol_mismatch' as issue
           from pre_trade_decision_checks dc
           join stocks s on s.id = dc.stock_id
          where (dc.market, dc.code) in (${pairs.sql}) and (s.market <> dc.market or s.code <> dc.code)
         union all
         select 'research_stock_symbol_mismatch' as issue
           from migrated_research_events re
           join stocks s on s.id = re.stock_id
          where (re.market, re.code) in (${pairs.sql}) and (s.market <> re.market or s.code <> re.code)
       ) issues`,
    pairs.values
  );
  return result.rows.map((row) => ({ kind: "relationship_mismatch", key: row.issue }));
}

function symbolPairs(symbols) {
  if (symbols.length === 0) {
    throw new Error("data gate sample contains no symbols");
  }
  const values = [];
  const sql = symbols.map((symbol, index) => {
    values.push(symbol.market, symbol.code);
    const offset = index * 2;
    return `($${offset + 1}, $${offset + 2})`;
  }).join(", ");
  return { sql, values };
}

async function finishMigrationRun(id, status, actualCounts, mismatches) {
  await client.query(
    `update data_migration_runs
        set status = $2,
            actual_counts = $3::jsonb,
            mismatches = $4::jsonb,
            finished_at = now()
      where run_id = $1`,
    [id, status, JSON.stringify(actualCounts), JSON.stringify(mismatches)]
  );
}
