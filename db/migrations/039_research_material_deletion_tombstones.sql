alter table research_materials
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_actor_id text,
  add column if not exists deletion_membership_version integer;

alter table research_materials
  drop constraint if exists research_materials_deletion_tombstone_check;

alter table research_materials
  add constraint research_materials_deletion_tombstone_check
  check (
    (deleted_at is null and deleted_by_actor_id is null and deletion_membership_version is null)
    or (
      deleted_at is not null
      and length(trim(deleted_by_actor_id)) between 1 and 200
      and deletion_membership_version > 0
      and title = '[deleted]'
      and content_text = '[deleted]'
      and verification_status = 'rejected'
      and rights_status = 'unknown'
      and citation_document_id is null
      and citation_page_number is null
      and citation_page_text_sha256 is null
    )
  );

drop index if exists research_materials_search_fts_idx;
create index research_materials_search_fts_idx
  on research_materials using gin (
    to_tsvector('simple'::regconfig, title || ' ' || content_text || ' ' || source_version)
  )
  where deleted_at is null;

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
      'research_material_deleted',
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

comment on column research_materials.deleted_at is
  'Owner-confirmed body deletion. The row retains only minimal identity and content hash for backup continuity.';
