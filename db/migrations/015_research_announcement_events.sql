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
    'research_event_created'
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
      'research_event_created'
    )
    or (
      request_fingerprint is not null
      and candidate_membership_id is not null
      and candidate_membership_version is not null
      and candidate_membership_version > 0
    )
  ) not valid;

create table if not exists research_events (
  id bigserial primary key,
  research_profile_id bigint not null references research_profiles(id),
  material_id bigint not null unique references research_materials(id),
  candidate_membership_id bigint not null references candidate_memberships(id),
  candidate_membership_version integer not null check (candidate_membership_version > 0),
  event_version integer not null check (event_version > 0),
  event_kind text not null check (event_kind in ('announcement', 'news')),
  coverage_scope text not null check (coverage_scope in ('research_stock', 'current_holding')),
  key_variable text not null check (length(trim(key_variable)) between 1 and 500),
  importance text not null check (importance in ('unknown', 'low', 'medium', 'high')),
  importance_reasons text[] not null check (cardinality(importance_reasons) > 0),
  hypothesis_impact text not null check (hypothesis_impact in ('supports', 'weakens', 'unknown')),
  event_fingerprint text not null unique check (event_fingerprint ~ '^[a-f0-9]{64}$'),
  holding_binding jsonb,
  created_at timestamptz not null default now(),
  unique (research_profile_id, event_version),
  check (
    (coverage_scope = 'research_stock' and holding_binding is null)
    or
    (coverage_scope = 'current_holding' and jsonb_typeof(holding_binding) = 'object')
  )
);

create index if not exists research_events_profile_created_idx
  on research_events (research_profile_id, created_at desc, id desc);
