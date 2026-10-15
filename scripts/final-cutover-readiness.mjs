import { readFile, stat } from "node:fs/promises";
import { Client } from "pg";

const samplePath = process.env.DATA_GATE_SAMPLE_PATH ?? "artifacts/data-gate/legacy-full-sample.json";
const stagingDatabaseUrl = process.env.STAGING_DATABASE_URL ?? process.env.DATABASE_URL;
const maxSampleAgeHours = Number(process.env.FINAL_CUTOVER_MAX_SAMPLE_AGE_HOURS ?? 24);

if (!stagingDatabaseUrl) {
  console.error("未验证: STAGING_DATABASE_URL or DATABASE_URL is required for final cutover readiness.");
  process.exit(2);
}

const sample = JSON.parse(await readFile(samplePath, "utf8"));
const sampleStats = await stat(samplePath);
const samples = normalizeSamples(sample);
const symbols = samples.map((item) => normalizeSymbol(item.symbol));
const expectedCounts = expectedCountsFor(sample, samples);
const expectedIds = expectedLegacyIds(sample, samples);
const sampleAgeHours = (Date.now() - sampleStats.mtimeMs) / 3_600_000;

const client = new Client({
  connectionString: stagingDatabaseUrl,
  application_name: "annual-rings-final-cutover-readiness"
});

await client.connect();

try {
  await client.query("begin transaction isolation level repeatable read read only");
  await client.query("set local statement_timeout = '10s'");
  await client.query("set local lock_timeout = '1s'");

  const actualCounts = await loadActualCounts(symbols);
  const actualIds = await loadActualLegacyIds(symbols);
  const relationshipIssues = await validateRelationships(symbols);
  const migrationRuns = await loadMigrationRunCounts();
  await client.query("commit");

  const mismatches = [
    ...compareCounts(expectedCounts, actualCounts),
    ...compareLegacyIds("positions", expectedIds.positions, actualIds.positions),
    ...compareLegacyIds("decisionChecks", expectedIds.decisionChecks, actualIds.decisionChecks),
    ...compareLegacyIds("researchEvents", expectedIds.researchEvents, actualIds.researchEvents),
    ...compareLegacyIds("globalResearchEvents", expectedIds.globalResearchEvents, actualIds.globalResearchEvents),
    ...relationshipIssues
  ];

  if (sampleAgeHours > maxSampleAgeHours) {
    mismatches.push({
      kind: "stale_sample",
      key: "sampleFileMtime",
      expected: `<= ${maxSampleAgeHours}h`,
      actual: `${sampleAgeHours.toFixed(2)}h`
    });
  }

  const result = {
    ok: mismatches.length === 0,
    samplePath,
    sampleMtime: sampleStats.mtime.toISOString(),
    sampleAgeHours: Number(sampleAgeHours.toFixed(2)),
    maxSampleAgeHours,
    symbols: symbols.map((item) => item.symbol),
    expectedCounts,
    actualCounts,
    migrationRuns,
    mismatches,
    checks: [
      "staging database was read through a repeatable-read read-only transaction",
      "candidate fact table counts match the latest data-gate sample",
      "candidate legacy ids match the latest data-gate sample",
      "candidate fact rows still point to matching stock symbols",
      "sample freshness is within FINAL_CUTOVER_MAX_SAMPLE_AGE_HOURS"
    ],
    notes: [
      "This command does not write production data.",
      "This command does not write staging data.",
      "Run data-gate export first when production has changed, then rerun this readiness check.",
      "trades/reviews remain out of scope until a non-empty production sample exists."
    ]
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exit(1);
  }
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

function normalizeSymbol(symbol) {
  const market = String(symbol.market).trim().toUpperCase();
  const code = String(symbol.code).trim().toUpperCase();
  return {
    market,
    code,
    symbol: `${market}.${code}`
  };
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

function expectedLegacyIds(payload, sampleItems) {
  return {
    positions: new Set(sampleItems.flatMap((item) => item.positions.map((row) => row.legacyId))),
    decisionChecks: new Set(sampleItems.flatMap((item) => item.decisionChecks.map((row) => row.legacyId))),
    researchEvents: new Set(sampleItems.flatMap((item) => item.researchEvents.map((row) => row.legacyId))),
    globalResearchEvents: new Set((payload.globalResearchEvents ?? []).map((row) => row.legacyId))
  };
}

async function loadActualCounts(items) {
  const pairs = symbolPairs(items);
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
  return normalizeExpectedCounts(result.rows[0]);
}

async function loadActualLegacyIds(items) {
  const pairs = symbolPairs(items);
  const positions = await client.query(
    `select legacy_id from portfolio_positions where (market, code) in (${pairs.sql}) order by legacy_id`,
    pairs.values
  );
  const decisions = await client.query(
    `select legacy_id from pre_trade_decision_checks where (market, code) in (${pairs.sql}) order by legacy_id`,
    pairs.values
  );
  const researchEvents = await client.query(
    `select legacy_id from migrated_research_events where (market, code) in (${pairs.sql}) order by legacy_id`,
    pairs.values
  );
  const globalResearchEvents = await client.query("select legacy_id from legacy_research_events order by legacy_id");
  return {
    positions: new Set(positions.rows.map((row) => row.legacy_id)),
    decisionChecks: new Set(decisions.rows.map((row) => row.legacy_id)),
    researchEvents: new Set(researchEvents.rows.map((row) => row.legacy_id)),
    globalResearchEvents: new Set(globalResearchEvents.rows.map((row) => row.legacy_id))
  };
}

async function validateRelationships(items) {
  const pairs = symbolPairs(items);
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

async function loadMigrationRunCounts() {
  const result = await client.query(
    `select
       count(*) filter (where status = 'succeeded')::integer as succeeded,
       count(*) filter (where status = 'failed')::integer as failed,
       count(*) filter (where status = 'running')::integer as running,
       max(finished_at) filter (where status = 'succeeded') as "latestSucceededAt"
     from data_migration_runs`
  );
  return result.rows[0];
}

function compareCounts(expected, actual) {
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

function compareLegacyIds(key, expectedSet, actualSet) {
  const missing = [...expectedSet].filter((id) => !actualSet.has(id));
  const unexpected = [...actualSet].filter((id) => !expectedSet.has(id));
  const issues = [];
  if (missing.length > 0) {
    issues.push({ kind: "missing_legacy_ids", key, count: missing.length, sample: missing.slice(0, 10) });
  }
  if (unexpected.length > 0) {
    issues.push({ kind: "unexpected_legacy_ids", key, count: unexpected.length, sample: unexpected.slice(0, 10) });
  }
  return issues;
}

function symbolPairs(items) {
  if (items.length === 0) {
    throw new Error("cutover readiness sample contains no symbols");
  }
  const values = [];
  const sql = items.map((symbol, index) => {
    values.push(symbol.market, symbol.code);
    const offset = index * 2;
    return `($${offset + 1}, $${offset + 2})`;
  }).join(", ");
  return { sql, values };
}
