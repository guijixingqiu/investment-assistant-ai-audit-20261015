alter table deep_research_tasks
  drop constraint if exists deep_research_tasks_generation_method_check;

alter table deep_research_tasks
  add constraint deep_research_tasks_generation_method_check
  check (generation_method in (
    'deterministic_frozen_fact_framework',
    'deepseek_chat_completions_selected_snapshot',
    'legacy_task_metadata_only'
  ));

update deep_research_tasks
set request_payload = jsonb_set(
      request_payload - 'snapshot' - 'synthesis',
      '{request,intent}',
      jsonb_build_object(
        'researchQuestion', '重新核验旧任务绑定的冻结证据。',
        'investmentHorizon', 'long_term',
        'cutoffAt', request_payload #>> '{request,evidencePackBinding,frozenAt}',
        'selectedMaterialIds', '[]'::jsonb,
        'includedStructuredSections', '["fundamentals","research_context","events","operating_monitor"]'::jsonb,
        'priorReport', null,
        'outputLanguage', 'zh-Hans',
        'fullTextPdfConsent', false
      ),
      true
    ),
    generation_method = case when status = 'succeeded'
      then 'legacy_task_metadata_only' else generation_method end,
    model_usage = case when status = 'succeeded'
      then 'LEGACY_TASK_METADATA_ONLY' else model_usage end,
    status = case when status = 'succeeded' then status else 'failed' end,
    error_code = case when status = 'succeeded' then error_code
      else 'contract_upgrade_restart_required' end,
    claim_token = null,
    lease_expires_at = null,
    completed_at = coalesce(completed_at, now()),
    updated_at = now()
where request_payload ? 'request'
  and request_payload #> '{request,intent}' is null;

alter table deep_research_tasks
  drop constraint if exists deep_research_tasks_status_check;

alter table deep_research_tasks
  add constraint deep_research_tasks_status_check
  check (status in ('pending', 'running', 'ready_to_absorb', 'succeeded', 'failed', 'canceled'));

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
    or (status = 'canceled' and claim_token is null and report_id is null and completed_at is not null and lease_expires_at is null and error_code in ('user_canceled', 'user_rejected'))
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
    'research_document_imported',
    'research_fundamental_value_created',
    'research_valuation_scenario_created',
    'evidence_pack_frozen',
    'deep_research_task_enqueued',
    'deep_research_task_canceled',
    'deep_research_report_created',
    'deep_research_report_decided',
    'research_event_created',
    'geely_sales_monitor_created',
    'gcl_pv_price_monitor_created',
    'today_material_change_dispositioned'
  ));

alter table research_write_audit_events
  drop constraint if exists research_write_audit_events_candidate_binding_check;

alter table research_write_audit_events
  add constraint research_write_audit_events_candidate_binding_check
  check (
    event_type not in (
      'profile_updated',
      'evidence_created',
      'research_material_created',
      'research_document_imported',
      'research_fundamental_value_created',
      'research_valuation_scenario_created',
      'evidence_pack_frozen',
      'deep_research_task_enqueued',
      'deep_research_task_canceled',
      'deep_research_report_created',
      'deep_research_report_decided',
      'research_event_created',
      'geely_sales_monitor_created',
      'gcl_pv_price_monitor_created',
      'today_material_change_dispositioned'
    )
    or (
      request_fingerprint is not null
      and candidate_membership_id is not null
      and candidate_membership_version is not null
      and candidate_membership_version > 0
    )
  ) not valid;
