// Formal research row closure. Every selector is scoped to the authenticated Owner's
// membership set. New tables must be reviewed here before they enter this format.
const memberScope = "m.actor_type='user' AND m.actor_id=$1";
const directScope = (table, events) =>
  `(a.target_table='${table}' AND a.event_type IN (${events.map((event) => `'${event}'`).join(',')}) AND EXISTS (
    SELECT 1 FROM ${table} t JOIN candidate_memberships m ON m.id=t.candidate_membership_id
    WHERE t.id::text=a.target_id AND ${memberScope}))`;
const profileScope = (table, events) =>
  `(a.target_table='${table}' AND a.event_type IN (${events.map((event) => `'${event}'`).join(',')}) AND EXISTS (
    SELECT 1 FROM ${table} t JOIN research_profiles p ON p.id=${table === 'research_profiles' ? 't.id' : 't.research_profile_id'}
    JOIN candidate_memberships m ON m.market=p.market AND m.code=p.code
    WHERE t.id::text=a.target_id AND ${memberScope}${table === 'evidence_items' ? " AND t.raw_payload->>'classification' IS DISTINCT FROM 'controlled_test_fixture' AND COALESCE((t.raw_payload->>'fixture')::boolean,false)=false" : ''}))`;
const auditScopes = [
  profileScope('research_profiles', ['profile_updated']),
  profileScope('evidence_items', ['evidence_created']),
  directScope('research_documents', ['research_document_imported']),
  directScope('research_fundamental_values', ['research_fundamental_value_created']),
  directScope('research_valuation_scenario_sets', ['research_valuation_scenario_created']),
  directScope('research_evidence_packs', ['evidence_pack_frozen']),
  directScope('research_events', ['research_event_created']),
  directScope('geely_sales_monitor_runs', ['geely_sales_monitor_created']),
  directScope('gcl_pv_price_monitor_runs', ['gcl_pv_price_monitor_created']),
  `(a.target_table='research_materials' AND a.event_type IN ('research_material_created','research_material_deleted') AND EXISTS (
    SELECT 1 FROM research_materials t LEFT JOIN candidate_memberships m ON m.id=t.candidate_membership_id
    WHERE t.id::text=a.target_id AND (${memberScope} OR (t.candidate_membership_id IS NULL AND t.rights_status<>'user_provided'
      AND (EXISTS (SELECT 1 FROM research_evidence_packs p JOIN candidate_memberships owned ON owned.id=p.candidate_membership_id
        CROSS JOIN LATERAL jsonb_array_elements(p.items) item WHERE owned.actor_type='user' AND owned.actor_id=$1 AND item->>'id'=a.target_id)
      OR EXISTS (SELECT 1 FROM research_events e JOIN candidate_memberships owned ON owned.id=e.candidate_membership_id
        WHERE owned.actor_type='user' AND owned.actor_id=$1 AND e.material_id=t.id))))))`,
  `(a.target_table='deep_research_reports' AND a.event_type IN ('deep_research_report_created','deep_research_report_deleted') AND EXISTS (
    SELECT 1 FROM deep_research_reports t JOIN research_evidence_packs p ON p.id=t.evidence_pack_id
    JOIN candidate_memberships m ON m.id=p.candidate_membership_id WHERE t.id::text=a.target_id AND ${memberScope}))`,
  `(a.target_table='deep_research_report_decisions' AND a.event_type='deep_research_report_decided' AND EXISTS (
    SELECT 1 FROM deep_research_report_decisions t JOIN deep_research_reports r ON r.id=t.report_id
    JOIN research_evidence_packs p ON p.id=r.evidence_pack_id JOIN candidate_memberships m ON m.id=p.candidate_membership_id
    WHERE t.id::text=a.target_id AND ${memberScope}))`,
  `(a.target_table='pre_trade_decision_checks' AND a.event_type IN ('decision_check_created','decision_check_deleted') AND EXISTS (
    SELECT 1 FROM pre_trade_decision_checks t JOIN research_profiles p ON p.stock_id=t.stock_id
    JOIN candidate_memberships m ON m.market=p.market AND m.code=p.code
    WHERE t.id::text=a.target_id AND a.stock_id=t.stock_id AND ${memberScope}))`,
  `(a.target_table='post_decision_reviews' AND a.event_type IN ('post_decision_review_created','post_decision_review_deleted') AND EXISTS (
    SELECT 1 FROM post_decision_reviews t JOIN pre_trade_decision_checks d ON d.id=t.decision_check_id
    JOIN research_profiles p ON p.stock_id=d.stock_id JOIN candidate_memberships m ON m.market=p.market AND m.code=p.code
    WHERE t.id::text=a.target_id AND t.actor_type='user' AND t.actor_id=$1 AND ${memberScope}))`
];
export const FORMAL_AUDIT_WHERE = `a.actor_type='user' AND a.actor_id=$1 AND (${auditScopes.join(' OR ')})`;
export const FORMAL_TABLES = Object.freeze([
  ['stocks', "(market, code) IN (SELECT market, code FROM candidate_memberships WHERE actor_type = 'user' AND actor_id = $1)"],
  ['research_profiles', '(market, code) IN (SELECT market, code FROM candidate_memberships WHERE actor_type = \'user\' AND actor_id = $1)'],
  ['candidate_memberships', "actor_type = 'user' AND actor_id = $1"],
  ['candidate_membership_audit_events', "actor_type = 'user' AND actor_id = $1 AND membership_id IN (SELECT id FROM candidate_memberships WHERE actor_type = 'user' AND actor_id = $1)"],
  ['research_documents', 'candidate_membership_id IN (SELECT id FROM candidate_memberships WHERE actor_type = \'user\' AND actor_id = $1)'],
  ['research_document_pages', 'document_id IN (SELECT id FROM research_documents WHERE candidate_membership_id IN (SELECT id FROM candidate_memberships WHERE actor_type = \'user\' AND actor_id = $1))'],
  ['research_source_snapshots', "actor_type = 'user' AND actor_id = $1 AND candidate_membership_id IN (SELECT id FROM candidate_memberships WHERE actor_type = 'user' AND actor_id = $1)"],
  ['research_futu_financial_statement_captures', "actor_type = 'user' AND actor_id = $1 AND candidate_membership_id IN (SELECT id FROM candidate_memberships WHERE actor_type = 'user' AND actor_id = $1)"],
  ['research_futu_financial_statement_pages', "actor_type = 'user' AND actor_id = $1 AND capture_id IN (SELECT id FROM research_futu_financial_statement_captures WHERE actor_type = 'user' AND actor_id = $1)"],
  ['research_futu_valuation_captures', "actor_type = 'user' AND actor_id = $1 AND candidate_membership_id IN (SELECT id FROM candidate_memberships WHERE actor_type = 'user' AND actor_id = $1)"],
  ['research_source_leads', 'candidate_membership_id IN (SELECT id FROM candidate_memberships WHERE actor_type = \'user\' AND actor_id = $1)'],
  ['research_source_lead_events', 'lead_id IN (SELECT lead_id FROM research_source_leads WHERE candidate_membership_id IN (SELECT id FROM candidate_memberships WHERE actor_type = \'user\' AND actor_id = $1))'],
  ['research_document_review_events', 'document_id IN (SELECT id FROM research_documents WHERE candidate_membership_id IN (SELECT id FROM candidate_memberships WHERE actor_type = \'user\' AND actor_id = $1))'],
  ['research_source_refresh_state', 'candidate_membership_id IN (SELECT id FROM candidate_memberships WHERE actor_type = \'user\' AND actor_id = $1)'],
  ['research_materials', "candidate_membership_id IN (SELECT id FROM candidate_memberships WHERE actor_type = 'user' AND actor_id = $1) OR (candidate_membership_id IS NULL AND rights_status <> 'user_provided' AND (id::text IN (SELECT item->>'id' FROM research_evidence_packs p JOIN candidate_memberships m ON m.id=p.candidate_membership_id CROSS JOIN LATERAL jsonb_array_elements(p.items) item WHERE m.actor_type='user' AND m.actor_id=$1) OR id IN (SELECT e.material_id FROM research_events e JOIN candidate_memberships m ON m.id=e.candidate_membership_id WHERE m.actor_type='user' AND m.actor_id=$1)))"],
  ['evidence_items', `((id IN (SELECT evidence_item_id FROM research_materials rm JOIN candidate_memberships m ON m.id=rm.candidate_membership_id WHERE ${memberScope} AND rm.evidence_item_id IS NOT NULL)
    OR id IN (SELECT rm.evidence_item_id FROM research_materials rm JOIN research_evidence_packs p ON EXISTS (SELECT 1 FROM jsonb_array_elements(p.items) item WHERE item->>'id'=rm.id::text)
      JOIN candidate_memberships m ON m.id=p.candidate_membership_id WHERE ${memberScope} AND rm.candidate_membership_id IS NULL AND rm.rights_status<>'user_provided' AND rm.evidence_item_id IS NOT NULL)
    OR id IN (SELECT rm.evidence_item_id FROM research_materials rm JOIN research_events e ON e.material_id=rm.id
      JOIN candidate_memberships m ON m.id=e.candidate_membership_id WHERE ${memberScope} AND rm.candidate_membership_id IS NULL AND rm.rights_status<>'user_provided' AND rm.evidence_item_id IS NOT NULL)
    OR id::text IN (SELECT a.target_id FROM research_write_audit_events a JOIN research_profiles p ON p.stock_id=a.stock_id JOIN candidate_memberships m ON m.market=p.market AND m.code=p.code
      WHERE a.actor_type='user' AND a.actor_id=$1 AND a.event_type='evidence_created' AND a.target_table='evidence_items' AND p.id=t.research_profile_id AND ${memberScope}))
    AND raw_payload->>'classification' IS DISTINCT FROM 'controlled_test_fixture' AND COALESCE((raw_payload->>'fixture')::boolean,false)=false)`],
  ['research_financial_requirements', "actor_type = 'user' AND actor_id = $1 AND candidate_membership_id IN (SELECT id FROM candidate_memberships WHERE actor_type = 'user' AND actor_id = $1)"],
  ['research_fundamental_values', 'candidate_membership_id IN (SELECT id FROM candidate_memberships WHERE actor_type = \'user\' AND actor_id = $1)'],
  ['research_fundamental_assertion_lifecycle', 'candidate_membership_id IN (SELECT id FROM candidate_memberships WHERE actor_type = \'user\' AND actor_id = $1)'],
  ['research_valuation_scenario_sets', 'candidate_membership_id IN (SELECT id FROM candidate_memberships WHERE actor_type = \'user\' AND actor_id = $1)'],
  ['research_evidence_packs', 'candidate_membership_id IN (SELECT id FROM candidate_memberships WHERE actor_type = \'user\' AND actor_id = $1)'],
  ['deep_research_reports', 'evidence_pack_id IN (SELECT id FROM research_evidence_packs WHERE candidate_membership_id IN (SELECT id FROM candidate_memberships WHERE actor_type = \'user\' AND actor_id = $1))'],
  ['deep_research_report_decisions', "report_id IN (SELECT r.id FROM deep_research_reports r JOIN research_evidence_packs p ON p.id = r.evidence_pack_id JOIN candidate_memberships m ON m.id = p.candidate_membership_id WHERE m.actor_type = 'user' AND m.actor_id = $1)"],
  ['research_events', 'candidate_membership_id IN (SELECT id FROM candidate_memberships WHERE actor_type = \'user\' AND actor_id = $1)'],
  ['geely_sales_monitor_runs', 'candidate_membership_id IN (SELECT id FROM candidate_memberships WHERE actor_type = \'user\' AND actor_id = $1)'],
  ['gcl_pv_price_monitor_runs', 'candidate_membership_id IN (SELECT id FROM candidate_memberships WHERE actor_type = \'user\' AND actor_id = $1)'],
  ['research_context_snapshots', "actor_type = 'user' AND actor_id = $1 AND candidate_membership_id IN (SELECT id FROM candidate_memberships WHERE actor_type = 'user' AND actor_id = $1)"],
  ['research_completeness_snapshots', "actor_id = $1 AND candidate_membership_id IN (SELECT id FROM candidate_memberships WHERE actor_type = 'user' AND actor_id = $1)"],
  ['research_underwriting_scenario_versions', "actor_type = 'user' AND actor_id = $1 AND candidate_membership_id IN (SELECT id FROM candidate_memberships WHERE actor_type = 'user' AND actor_id = $1)"],
  ['research_baseline_snapshots', "actor_type = 'user' AND actor_id = $1 AND candidate_membership_id IN (SELECT id FROM candidate_memberships WHERE actor_type = 'user' AND actor_id = $1)"],
  ['research_validation_milestones', "actor_type = 'user' AND actor_id = $1 AND candidate_membership_id IN (SELECT id FROM candidate_memberships WHERE actor_type = 'user' AND actor_id = $1)"],
  ['research_review_snapshots', "actor_type = 'user' AND actor_id = $1 AND candidate_membership_id IN (SELECT id FROM candidate_memberships WHERE actor_type = 'user' AND actor_id = $1)"],
  ['research_write_audit_events', FORMAL_AUDIT_WHERE],
  ['pre_trade_decision_checks', `EXISTS (SELECT 1 FROM research_write_audit_events a JOIN research_profiles p ON p.stock_id=t.stock_id
    JOIN candidate_memberships m ON m.market=p.market AND m.code=p.code WHERE a.actor_type='user' AND a.actor_id=$1
    AND a.event_type='decision_check_created' AND a.target_table='pre_trade_decision_checks' AND a.target_id=t.id::text AND a.stock_id=t.stock_id AND ${memberScope})`],
  ['post_decision_reviews', `actor_type='user' AND actor_id=$1 AND EXISTS (SELECT 1 FROM pre_trade_decision_checks d
    JOIN research_write_audit_events a ON a.target_table='pre_trade_decision_checks' AND a.target_id=d.id::text AND a.event_type='decision_check_created'
    JOIN research_profiles p ON p.stock_id=d.stock_id JOIN candidate_memberships m ON m.market=p.market AND m.code=p.code
    WHERE d.id=t.decision_check_id AND a.actor_type='user' AND a.actor_id=$1 AND ${memberScope})`]
]);
export const EXCLUDED_TABLES = Object.freeze(['deep_research_tasks', 'assets_alpha_*', 'portfolio_positions', 'ai_*']);
