alter table deep_research_reports
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_actor_id text,
  add column if not exists deletion_membership_version integer;

alter table deep_research_reports
  drop constraint if exists deep_research_reports_deletion_tombstone_check;

alter table deep_research_reports
  add constraint deep_research_reports_deletion_tombstone_check
  check (
    (deleted_at is null and deleted_by_actor_id is null and deletion_membership_version is null)
    or (
      deleted_at is not null
      and length(trim(deleted_by_actor_id)) between 1 and 200
      and deletion_membership_version > 0
      and report_payload = '{"state":"deleted"}'::jsonb
    )
  );

create or replace function reject_deep_research_report_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and old.deleted_at is null
     and new.deleted_at is not null
     and new.id = old.id
     and new.research_profile_id = old.research_profile_id
     and new.evidence_pack_id = old.evidence_pack_id
     and new.version = old.version
     and new.report_contract_version is not distinct from old.report_contract_version
     and new.report_fingerprint is not distinct from old.report_fingerprint
     and new.status = old.status
     and new.gate_failures = old.gate_failures
     and new.created_at = old.created_at
     and new.report_payload = '{"state":"deleted"}'::jsonb
  then
    return new;
  end if;
  raise exception 'deep research reports are append-only except one-way Owner-confirmed body deletion';
end;
$$;

alter table deep_research_tasks
  drop constraint if exists deep_research_tasks_state_check;

alter table deep_research_tasks
  add constraint deep_research_tasks_state_check
  check (
    (status = 'pending' and claim_token is null and report_id is null and completed_at is null and lease_expires_at is null)
    or (status = 'running' and claim_token is not null and attempt_count > 0 and report_id is null and completed_at is null and lease_expires_at is not null)
    or (status = 'ready_to_absorb' and claim_token is null and report_id is null and completed_at is not null and lease_expires_at is null and error_code is null)
    or (status = 'succeeded' and claim_token is null and report_id is not null and completed_at is not null and lease_expires_at is null and error_code is null)
    or (status = 'failed' and claim_token is null and report_id is null and completed_at is not null and lease_expires_at is null and error_code is not null)
    or (status = 'canceled' and claim_token is null and report_id is null and completed_at is not null and lease_expires_at is null and error_code in ('user_canceled', 'user_rejected', 'report_deleted'))
  );

alter table research_write_audit_events
  drop constraint if exists research_write_audit_events_event_type_check;

alter table research_write_audit_events
  add constraint research_write_audit_events_event_type_check
  check (event_type in (
    'profile_updated',
    'evidence_created',
    'decision_check_created',
    'post_decision_review_created',
    'research_material_created',
    'research_material_deleted',
    'research_document_imported',
    'research_fundamental_value_created',
    'research_valuation_scenario_created',
    'evidence_pack_frozen',
    'deep_research_task_enqueued',
    'deep_research_task_canceled',
    'deep_research_report_created',
    'deep_research_report_decided',
    'deep_research_report_deleted',
    'research_event_created',
    'geely_sales_monitor_created',
    'gcl_pv_price_monitor_created',
    'research_evidence_question_attempted',
    'research_evidence_question_answered',
    'today_material_change_dispositioned'
  ));

alter table research_write_audit_events
  drop constraint if exists research_write_audit_events_candidate_binding_check;

alter table research_write_audit_events
  add constraint research_write_audit_events_candidate_binding_check
  check (
    event_type not in (
      'profile_updated', 'evidence_created', 'research_material_created', 'research_material_deleted',
      'research_document_imported', 'research_fundamental_value_created', 'research_valuation_scenario_created',
      'evidence_pack_frozen', 'deep_research_task_enqueued', 'deep_research_task_canceled',
      'deep_research_report_created', 'deep_research_report_decided', 'deep_research_report_deleted',
      'research_event_created', 'geely_sales_monitor_created', 'gcl_pv_price_monitor_created',
      'research_evidence_question_attempted', 'research_evidence_question_answered',
      'today_material_change_dispositioned'
    )
    or (
      request_fingerprint is not null
      and candidate_membership_id is not null
      and candidate_membership_version is not null
      and candidate_membership_version > 0
    )
  ) not valid;

comment on column deep_research_reports.deleted_at is
  'Owner-confirmed report body deletion; immutable report identity remains as a contentless tombstone.';
