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
    'deep_research_report_decided'
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
      'deep_research_report_decided'
    )
    or (
      request_fingerprint is not null
      and candidate_membership_id is not null
      and candidate_membership_version is not null
      and candidate_membership_version > 0
    )
  ) not valid;

create table if not exists research_materials (
  id bigserial primary key,
  research_profile_id bigint not null references research_profiles(id),
  evidence_item_id bigint not null unique references evidence_items(id),
  replaces_material_id bigint unique references research_materials(id),
  revision integer not null check (revision > 0),
  material_kind text not null check (material_kind = 'text'),
  title text not null check (length(trim(title)) between 1 and 500),
  content_text text not null check (length(trim(content_text)) between 1 and 100000),
  content_fingerprint text not null check (content_fingerprint ~ '^[a-f0-9]{64}$'),
  claim_type text not null check (claim_type in (
    'verified_fact',
    'issuer_statement',
    'third_party_statement',
    'model_inference'
  )),
  verification_status text not null check (verification_status in (
    'verified',
    'unverified',
    'conflict',
    'rejected'
  )),
  rights_status text not null check (rights_status in (
    'user_provided',
    'authorized_public',
    'restricted',
    'unknown'
  )),
  source_version text not null check (length(trim(source_version)) between 1 and 200),
  valid_until timestamptz not null,
  created_at timestamptz not null default now(),
  check (replaces_material_id is null or replaces_material_id <> id),
  unique (research_profile_id, content_fingerprint, source_version)
);

create index if not exists research_materials_profile_created_idx
  on research_materials (research_profile_id, created_at desc, id desc);

create table if not exists research_evidence_packs (
  id bigserial primary key,
  research_profile_id bigint not null references research_profiles(id),
  candidate_membership_id bigint not null references candidate_memberships(id),
  candidate_membership_version integer not null check (candidate_membership_version > 0),
  version integer not null check (version > 0),
  pack_fingerprint text not null check (pack_fingerprint ~ '^[a-f0-9]{64}$'),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0),
  frozen_at timestamptz not null default now(),
  unique (research_profile_id, version),
  unique (research_profile_id, pack_fingerprint)
);

create index if not exists research_evidence_packs_profile_frozen_idx
  on research_evidence_packs (research_profile_id, frozen_at desc, id desc);

create table if not exists deep_research_reports (
  id bigserial primary key,
  research_profile_id bigint not null references research_profiles(id),
  evidence_pack_id bigint not null references research_evidence_packs(id),
  version integer not null check (version > 0),
  status text not null check (status in ('evidence_insufficient', 'complete_pending_confirmation')),
  report_payload jsonb not null check (jsonb_typeof(report_payload) = 'object'),
  gate_failures text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (research_profile_id, version)
);

create index if not exists deep_research_reports_profile_created_idx
  on deep_research_reports (research_profile_id, created_at desc, id desc);

create table if not exists deep_research_report_decisions (
  id bigserial primary key,
  report_id bigint not null unique references deep_research_reports(id),
  decision text not null check (decision in ('confirmed', 'rejected')),
  note text,
  actor_type text not null check (actor_type = 'user'),
  actor_id text not null,
  created_at timestamptz not null default now()
);
