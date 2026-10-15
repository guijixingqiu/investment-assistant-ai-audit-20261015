// Read-only Owner-scope integrity witness for the isolated Phase 11 database copy.
import assert from 'node:assert/strict';
import pg from 'pg';
const database=process.env.PHASE11_TEST_DATABASE_URL??'';
assert.match(database,/^postgres(?:ql)?:\/\/[^@]+@(?:127\.0\.0\.1|localhost):/);
const pool=new pg.Pool({connectionString:database});
const actor='step6-public-research-verified';
const queries={
 fundamentals:`select * from research_fundamental_values where candidate_membership_id in (select id from candidate_memberships where actor_id=$1)`,
 contexts:`select * from research_context_snapshots where actor_id=$1`,
 materials:`select * from research_materials where candidate_membership_id in (select id from candidate_memberships where actor_id=$1)`,
 valuationSets:`select * from research_valuation_scenario_sets where candidate_membership_id in (select id from candidate_memberships where actor_id=$1)`,
 reports:`select * from deep_research_reports where evidence_pack_id in (select p.id from research_evidence_packs p join candidate_memberships cm on cm.id=p.candidate_membership_id where cm.actor_id=$1)`,
 decisions:`select * from deep_research_report_decisions where actor_id=$1`,
 reviews:`select * from post_decision_reviews where actor_id=$1`
};
try {
 const output={actorScope:actor,tables:{}};
 for(const [name,query] of Object.entries(queries)){
  const result=await pool.query(`select count(*)::int count,md5(coalesce(string_agg(md5(row_to_json(t)::text),',' order by t.id),'')) digest from (${query}) t`,[actor]);
  output.tables[name]=result.rows[0];
 }
 process.stdout.write(JSON.stringify(output,null,2)+'\n');
} finally { await pool.end(); }
