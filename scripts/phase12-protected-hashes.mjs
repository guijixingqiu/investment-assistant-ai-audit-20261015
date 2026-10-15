// Read-only Owner-copy witness. This script never runs migrations or writes rows.
import assert from 'node:assert/strict';
import pg from 'pg';
const database=process.env.PHASE12_OWNER_COPY_DATABASE_URL??'';
assert.match(database,/^postgres(?:ql)?:\/\/[^@]+@(?:127\.0\.0\.1|localhost):/);
const pool=new pg.Pool({connectionString:database});
const actor='step6-public-research-verified';
const queries={
 fundamentals:`select * from research_fundamental_values where candidate_membership_id in (select id from candidate_memberships where actor_id=$1)`,
 contexts:`select * from research_context_snapshots where actor_id=$1`,
 materials:`select * from research_materials where candidate_membership_id in (select id from candidate_memberships where actor_id=$1)`,
 reports:`select * from deep_research_reports where evidence_pack_id in (select p.id from research_evidence_packs p join candidate_memberships cm on cm.id=p.candidate_membership_id where cm.actor_id=$1)`,
 decisions:`select * from deep_research_report_decisions where actor_id=$1`,
 reviews:`select * from post_decision_reviews where actor_id=$1`,
 valuationSets:`select * from research_valuation_scenario_sets where candidate_membership_id in (select id from candidate_memberships where actor_id=$1)`,
 scenarioVersions:`select * from research_underwriting_scenario_versions where actor_id=$1`,
 baselines:`select * from research_baseline_snapshots where actor_id=$1`,
 phase12Milestones:`select * from research_validation_milestones where actor_id=$1`,
 phase12Reviews:`select * from research_review_snapshots where actor_id=$1`
};
try {
 const output={actorScope:actor,database:(await pool.query('select current_database() name')).rows[0].name,tables:{}};
 for(const [name,query] of Object.entries(queries)){
  const table=/from ([a-z_]+)/.exec(query)?.[1];
  const exists=(await pool.query('select to_regclass($1) name',[`public.${table}`])).rows[0].name;
  if(!exists){output.tables[name]={status:'NOT_APPLIED',count:null,digest:null};continue;}
  output.tables[name]=(await pool.query(`select count(*)::int count,md5(coalesce(string_agg(md5(row_to_json(t)::text),',' order by t.id),'')) digest from (${query}) t`,[actor])).rows[0];
 }
 process.stdout.write(JSON.stringify(output,null,2)+'\n');
}finally{await pool.end();}
