import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const legacyDatabaseName = `annual_rings_legacy_export_${Date.now()}`;
const candidateDatabaseName = `annual_rings_legacy_import_${Date.now()}`;
const legacyDatabaseUrl = `postgres://localhost/${legacyDatabaseName}`;
const candidateDatabaseUrl = `postgres://localhost/${candidateDatabaseName}`;
const workDir = await mkdtemp(path.join(tmpdir(), "annual-rings-data-gate-"));
const exportedSamplePath = path.join(workDir, "legacy-sample.json");

try {
  await run("createdb", [legacyDatabaseName]);
  await run("createdb", [candidateDatabaseName]);
  console.log(`created ${legacyDatabaseName}`);
  console.log(`created ${candidateDatabaseName}`);

  await runSql(legacyDatabaseName, legacySchemaSql());
  await runSql(legacyDatabaseName, legacySeedSql());
  await run("node", ["scripts/data-gate-export-legacy-sample.mjs"], {
    SOURCE_DATABASE_URL: legacyDatabaseUrl,
    DATA_GATE_SYMBOL: "HK.09926",
    DATA_GATE_OUTPUT_PATH: exportedSamplePath
  });

  const exported = JSON.parse(await readFile(exportedSamplePath, "utf8"));
  assertExportedSample(exported);

  await run("npm", ["run", "migrate"], { DATABASE_URL: candidateDatabaseUrl });
  await run("node", ["scripts/data-gate-sample-reconcile.mjs"], {
    DATABASE_URL: candidateDatabaseUrl,
    DATA_GATE_SAMPLE_PATH: exportedSamplePath,
    DATA_GATE_RUN_ID: "legacy-export-verify"
  });

  const counts = await run("psql", [
    "-d",
    candidateDatabaseName,
    "-Atc",
    `select 'portfolio_positions|' || count(*) from portfolio_positions
     union all select 'pre_trade_decision_checks|' || count(*) from pre_trade_decision_checks
     union all select 'migrated_research_events|' || count(*) from migrated_research_events
     union all select 'succeeded_runs|' || count(*) from data_migration_runs where status = 'succeeded'
     order by 1;`
  ]);
  const parsed = Object.fromEntries(counts.stdout.trim().split("\n").map((line) => line.split("|")));
  assertCount(parsed, "portfolio_positions", "1");
  assertCount(parsed, "pre_trade_decision_checks", "1");
  assertCount(parsed, "migrated_research_events", "2");
  assertCount(parsed, "succeeded_runs", "1");
  console.log("Data gate legacy export/import smoke selected HK.09926, exported a safe sample, and reconciled it in a candidate database.");
} finally {
  try {
    await run("dropdb", ["--if-exists", legacyDatabaseName]);
    await run("dropdb", ["--if-exists", candidateDatabaseName]);
    await rm(workDir, { recursive: true, force: true });
    console.log(`dropped ${legacyDatabaseName}`);
    console.log(`dropped ${candidateDatabaseName}`);
  } catch (error) {
    console.error("未验证: failed to clean up temporary data gate export smoke resources.");
    throw error;
  }
}

function assertExportedSample(sample) {
  assertEqual(sample.sourceLabel, "legacy-readonly-export", "sourceLabel");
  assertEqual(sample.symbol.market, "HK", "symbol.market");
  assertEqual(sample.symbol.code, "09926", "symbol.code");
  assertEqual(sample.expectedCounts.positions, 1, "positions");
  assertEqual(sample.expectedCounts.decisionChecks, 1, "decisionChecks");
  assertEqual(sample.expectedCounts.researchEvents, 2, "researchEvents");
  assertEqual(sample.expectedCounts.trades, 0, "trades");
  assertEqual(sample.expectedCounts.reviews, 0, "reviews");
}

function assertCount(counts, table, expected) {
  if (counts[table] !== expected) {
    throw new Error(`expected ${table} count ${expected}, got ${counts[table] ?? "<missing>"}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`expected ${label}=${expected}, got ${actual}`);
  }
}

async function runSql(databaseName, sql) {
  const sqlPath = path.join(workDir, `${databaseName}.sql`);
  await writeFile(sqlPath, sql, "utf8");
  await run("psql", ["-d", databaseName, "-v", "ON_ERROR_STOP=1", "-f", sqlPath]);
}

async function run(command, args, extraEnv = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...extraEnv
      },
      maxBuffer: 10 * 1024 * 1024
    });
    if (result.stdout.trim()) console.log(result.stdout.trim());
    if (result.stderr.trim()) console.error(result.stderr.trim());
    return result;
  } catch (error) {
    if (error && typeof error === "object") {
      const maybeOutput = error;
      if (typeof maybeOutput.stdout === "string" && maybeOutput.stdout.trim()) console.log(maybeOutput.stdout.trim());
      if (typeof maybeOutput.stderr === "string" && maybeOutput.stderr.trim()) console.error(maybeOutput.stderr.trim());
    }
    throw error;
  }
}

function legacySchemaSql() {
  return `
create table stocks (
  id bigserial primary key,
  market varchar(16) not null,
  ticker varchar(32) not null,
  name varchar(128) not null,
  updated_at timestamp not null default now(),
  unique (market, ticker)
);

create table positions (
  id bigserial primary key,
  stock_id bigint not null references stocks(id),
  average_cost numeric(18,4),
  quantity numeric(18,4),
  current_weight numeric(10,4),
  max_weight numeric(10,4),
  unrealized_pnl numeric(18,4),
  status varchar(32) not null default 'holding',
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);

create table trades (
  id bigserial primary key,
  stock_id bigint not null references stocks(id)
);

create table reviews (
  id bigserial primary key,
  stock_id bigint not null references stocks(id)
);

create table decision_checks (
  id bigserial primary key,
  stock_id bigint not null references stocks(id),
  action_intent varchar(32) not null,
  requested_price numeric(18,4),
  requested_quantity numeric(18,4),
  current_price numeric(18,4),
  current_quantity numeric(18,4),
  average_cost numeric(18,4),
  market_value numeric(18,4),
  current_weight numeric(10,4),
  verdict varchar(32) not null,
  user_final_decision varchar(32),
  decided_at timestamp,
  created_at timestamp not null default now()
);

create table research_events (
  id bigserial primary key,
  source varchar(64) not null default 'telegram',
  title varchar(256),
  summary text,
  event_type varchar(64) not null default 'note',
  impact_direction varchar(32) not null default 'neutral',
  confidence varchar(32) not null default 'medium',
  created_at timestamp not null default now()
);

create table research_event_stocks (
  event_id bigint not null references research_events(id),
  stock_id bigint not null references stocks(id),
  primary key (event_id, stock_id)
);
`;
}

function legacySeedSql() {
  return `
insert into stocks (market, ticker, name, updated_at)
values ('HK', '09926', '康方生物', '2026-06-17T08:00:00Z');

insert into positions
  (stock_id, average_cost, quantity, current_weight, max_weight, unrealized_pnl, status, created_at, updated_at)
select id, 72.5, 1200, 0.12, 0.2, 1368.00, 'holding', '2026-06-17T07:00:00Z', '2026-06-17T08:00:00Z'
from stocks where market = 'HK' and ticker = '09926';

insert into decision_checks
  (stock_id, action_intent, requested_price, requested_quantity, current_price,
   current_quantity, average_cost, market_value, current_weight, verdict,
   user_final_decision, decided_at, created_at)
select id, 'buy', 74.25, 200, 74.25, 1200, 72.5, 89100, 0.12, 'caution',
       'defer', '2026-06-17T08:10:00Z', '2026-06-17T08:05:00Z'
from stocks where market = 'HK' and ticker = '09926';

insert into research_events
  (source, title, summary, event_type, impact_direction, confidence, created_at)
values
  ('company_disclosure', '商业化进展跟踪', '公司披露核心产品仍处于商业化放量阶段。', 'announcement', 'positive', 'high', '2026-06-16T12:00:00Z'),
  ('ai_inference', '竞争风险复核', '若同类竞争加剧，价格和市场份额可能承压。', 'risk_note', 'negative', 'medium', '2026-06-17T01:00:00Z');

insert into research_event_stocks (event_id, stock_id)
select re.id, s.id
from research_events re
cross join stocks s
where s.market = 'HK' and s.ticker = '09926';
`;
}
