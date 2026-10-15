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
    'deep_research_report_created',
    'deep_research_report_decided',
    'research_event_created',
    'geely_sales_monitor_created',
    'gcl_pv_price_monitor_created'
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
      'deep_research_report_created',
      'deep_research_report_decided',
      'research_event_created',
      'geely_sales_monitor_created',
      'gcl_pv_price_monitor_created'
    )
    or (
      request_fingerprint is not null
      and candidate_membership_id is not null
      and candidate_membership_version is not null
      and candidate_membership_version > 0
    )
  ) not valid;

create table deep_research_tasks (
  id bigserial primary key,
  candidate_membership_id bigint not null references candidate_memberships(id) on delete restrict,
  candidate_membership_version integer not null check (candidate_membership_version > 0),
  evidence_pack_id bigint not null references research_evidence_packs(id) on delete restrict,
  evidence_pack_fingerprint text not null check (evidence_pack_fingerprint ~ '^[a-f0-9]{64}$'),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  actor_type text not null check (actor_type in ('user', 'system')),
  actor_id text not null check (length(trim(actor_id)) between 1 and 200),
  request_payload jsonb not null check (jsonb_typeof(request_payload) = 'object'),
  generation_method text not null default 'deterministic_frozen_fact_framework'
    check (generation_method = 'deterministic_frozen_fact_framework'),
  model_usage text not null default 'NOT_USED' check (model_usage = 'NOT_USED'),
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  claim_token text,
  lease_expires_at timestamptz,
  report_id bigint references deep_research_reports(id) on delete restrict,
  error_code text check (error_code is null or length(trim(error_code)) between 1 and 200),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (
    candidate_membership_id,
    candidate_membership_version,
    evidence_pack_id,
    request_fingerprint,
    actor_type,
    actor_id
  ),
  check (
    (status = 'pending' and claim_token is null and report_id is null and completed_at is null and lease_expires_at is null)
    or (status = 'running' and claim_token is not null and attempt_count > 0 and report_id is null and completed_at is null and lease_expires_at is not null)
    or (status = 'succeeded' and claim_token is null and report_id is not null and completed_at is not null and lease_expires_at is null and error_code is null)
    or (status = 'failed' and claim_token is null and report_id is null and completed_at is not null and lease_expires_at is null and error_code is not null)
  )
);

create index deep_research_tasks_claim_idx
  on deep_research_tasks (status, lease_expires_at, created_at, id);

create index deep_research_tasks_membership_idx
  on deep_research_tasks (candidate_membership_id, created_at desc, id desc);
