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
    'evidence_pack_frozen',
    'deep_research_report_created',
    'deep_research_report_decided',
    'research_event_created',
    'geely_sales_monitor_created'
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
      'evidence_pack_frozen',
      'deep_research_report_created',
      'deep_research_report_decided',
      'research_event_created',
      'geely_sales_monitor_created'
    )
    or (
      request_fingerprint is not null
      and candidate_membership_id is not null
      and candidate_membership_version is not null
      and candidate_membership_version > 0
    )
  ) not valid;

create table if not exists geely_sales_monitor_runs (
  id bigserial primary key,
  research_profile_id bigint not null references research_profiles(id),
  candidate_membership_id bigint not null references candidate_memberships(id),
  candidate_membership_version integer not null check (candidate_membership_version > 0),
  run_version integer not null check (run_version > 0),
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  input_fingerprint text not null unique check (input_fingerprint ~ '^[a-f0-9]{64}$'),
  run_fingerprint text not null unique check (run_fingerprint ~ '^[a-f0-9]{64}$'),
  source_event_ids bigint[] not null check (cardinality(source_event_ids) between 1 and 200),
  observations_payload jsonb not null check (jsonb_typeof(observations_payload) = 'array'),
  assessment_payload jsonb not null check (jsonb_typeof(assessment_payload) = 'object'),
  created_at timestamptz not null default now(),
  unique (research_profile_id, run_version)
);

create index if not exists geely_sales_monitor_runs_profile_created_idx
  on geely_sales_monitor_runs (research_profile_id, created_at desc, id desc);
