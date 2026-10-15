import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("未验证: DATABASE_URL is required for the read-only database audit.");
  process.exit(2);
}

const sampleLimit = parseInteger(process.env.AUDIT_SAMPLE_LIMIT, 10);
const criticalTables = [
  "trades",
  "broker_trades",
  "broker_raw_transactions",
  "positions",
  "position_snapshots",
  "decision_checks",
  "reviews",
  "research_events",
  "research_event_stocks",
  "research_goals",
  "research_goal_evidence",
  "investment_cards",
  "investment_profiles",
  "market_quotes",
  "market_daily_bars",
  "stocks",
  "stock_focus_universe",
  "sources",
  "source_imports",
  "source_credentials",
  "agent_runs",
  "agent_reports",
  "audit_logs"
];

const countTables = [
  "trades",
  "positions",
  "decision_checks",
  "reviews",
  "research_events",
  "market_quotes",
  "stocks",
  "investment_cards",
  "sources",
  "agent_runs",
  "agent_reports"
];

const client = new Client({
  connectionString: databaseUrl,
  application_name: "annual-rings-readonly-audit"
});

await client.connect();

try {
  await client.query("begin transaction isolation level repeatable read read only");
  await client.query("set local statement_timeout = '5s'");
  await client.query("set local lock_timeout = '1s'");

  const identity = await one(`
    select current_database() as database_name,
           current_user as user_name,
           now() as captured_at
  `);
  const tableRows = await all(`
    select table_name
      from information_schema.tables
     where table_schema = 'public'
       and table_type = 'BASE TABLE'
     order by table_name
  `);
  const tableNames = tableRows.map((row) => row.table_name);
  const tableSet = new Set(tableNames);
  const columnsByTable = await loadColumns(tableNames);
  const tableCounts = {};

  for (const table of countTables) {
    if (tableSet.has(table)) {
      tableCounts[table] = Number((await one(`select count(*)::bigint as count from ${quoteIdent(table)}`)).count);
    }
  }

  const stockSamples = tableSet.has("stocks")
    ? await loadStockSamples(columnsByTable.get("stocks") ?? new Set(), sampleLimit)
    : [];
  const marketQuoteSamples = tableSet.has("market_quotes")
    ? await loadMarketQuoteSamples(columnsByTable.get("market_quotes") ?? new Set(), sampleLimit)
    : [];

  await client.query("commit");

  console.log(JSON.stringify({
    ok: true,
    mode: "read-only",
    capturedAt: new Date(identity.captured_at).toISOString(),
    database: {
      name: identity.database_name,
      user: identity.user_name
    },
    schema: {
      tableCount: tableNames.length,
      criticalTables: Object.fromEntries(criticalTables.map((table) => [table, tableSet.has(table)])),
      tables: tableNames
    },
    rowCounts: tableCounts,
    samples: {
      stocks: stockSamples,
      marketQuotes: marketQuoteSamples
    },
    notes: [
      "This audit uses a repeatable-read read-only transaction.",
      "It reports counts and low-sensitivity stock/quote samples only; it does not read trade details, credentials, source bodies, logs, or user secrets.",
      "Counts are exact for the listed tables at the transaction snapshot, but this is not a migration reconciliation."
    ]
  }, null, 2));
} catch (error) {
  try {
    await client.query("rollback");
  } catch {
    // Ignore rollback failure while reporting the original audit error.
  }
  throw error;
} finally {
  await client.end();
}

async function loadColumns(tableNames) {
  if (tableNames.length === 0) return new Map();
  const result = await client.query(
    `select table_name, column_name
       from information_schema.columns
      where table_schema = 'public'
        and table_name = any($1::text[])
      order by table_name, ordinal_position`,
    [tableNames]
  );
  const columnsByTable = new Map();
  for (const row of result.rows) {
    const columns = columnsByTable.get(row.table_name) ?? new Set();
    columns.add(row.column_name);
    columnsByTable.set(row.table_name, columns);
  }
  return columnsByTable;
}

async function loadStockSamples(columns, limit) {
  const selectColumns = ["market", "code", "symbol", "name"]
    .filter((column) => columns.has(column));
  if (selectColumns.length === 0) return [];

  const orderColumn = ["updated_at", "created_at", "id", "symbol", "code"]
    .find((column) => columns.has(column));
  const orderSql = orderColumn ? ` order by ${quoteIdent(orderColumn)} desc nulls last` : "";
  const result = await client.query(
    `select ${selectColumns.map(quoteIdent).join(", ")}
       from stocks
      ${orderSql}
      limit $1`,
    [limit]
  );
  return result.rows;
}

async function loadMarketQuoteSamples(columns, limit) {
  const selectColumns = ["market", "code", "symbol", "provider", "provider_status", "quote_time", "fetched_at"]
    .filter((column) => columns.has(column));
  if (selectColumns.length === 0) return [];

  const orderColumn = ["quote_time", "fetched_at", "id"]
    .find((column) => columns.has(column));
  const orderSql = orderColumn ? ` order by ${quoteIdent(orderColumn)} desc nulls last` : "";
  const result = await client.query(
    `select ${selectColumns.map(quoteIdent).join(", ")}
       from market_quotes
      ${orderSql}
      limit $1`,
    [limit]
  );
  return result.rows.map((row) => ({
    ...row,
    quote_time: row.quote_time instanceof Date ? row.quote_time.toISOString() : row.quote_time,
    fetched_at: row.fetched_at instanceof Date ? row.fetched_at.toISOString() : row.fetched_at
  }));
}

async function one(sql) {
  const result = await client.query(sql);
  return result.rows[0];
}

async function all(sql) {
  const result = await client.query(sql);
  return result.rows;
}

function quoteIdent(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function parseInteger(value, fallback) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
