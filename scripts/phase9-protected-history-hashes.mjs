// Read-only integrity snapshot. The whitelist excludes source-intake tables and prints digests only.
import assert from 'node:assert/strict';
import pg from 'pg';
const database=process.env.PHASE9_TEST_DATABASE_URL??'';
assert.match(database,/^postgres(?:ql)?:\/\/[^@]+@(?:127\.0\.0\.1|localhost):/);
const tables=['research_fundamental_values','research_context_snapshots','research_materials','research_valuation_scenario_sets','deep_research_reports','deep_research_report_decisions','post_decision_reviews','pre_trade_decision_checks'];
const pool=new pg.Pool({connectionString:database});
try{const result={observedAt:new Date().toISOString(),tables:{}};for(const table of tables){const row=(await pool.query(`select count(*)::int count,md5(coalesce(string_agg(md5(row_to_json(t)::text),',' order by md5(row_to_json(t)::text)),'')) digest from ${table} t`)).rows[0];result.tables[table]=row;}process.stdout.write(JSON.stringify(result,null,2)+'\n');}finally{await pool.end();}
