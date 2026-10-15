-- Phase 12: one primary milestone per current Thesis lineage, with immutable history.
create table research_validation_milestones (
  id uuid primary key default gen_random_uuid(),
  ordinal bigserial unique,
  candidate_membership_id bigint not null references candidate_memberships(id) on delete restrict,
  captured_membership_version integer not null check (captured_membership_version > 0),
  symbol text not null,
  actor_type text not null,
  actor_id text not null,
  baseline_id uuid not null references research_baseline_snapshots(id) on delete restrict,
  context_id bigint not null references research_context_snapshots(id) on delete restrict,
  original_thesis_identity jsonb not null,
  thesis_lineage_id text not null,
  created_from_action_id text,
  description text not null,
  expected_evidence text not null,
  requirement jsonb,
  linked_question_ids jsonb not null default '[]'::jsonb,
  linked_thesis_test_ids jsonb not null default '[]'::jsonb,
  target_date date,
  test_state_fingerprint_at_creation text not null,
  test_definition_fingerprint_at_creation text not null,
  evidence_fingerprint_at_creation text not null,
  supersedes_milestone_id uuid references research_validation_milestones(id) on delete restrict,
  payload jsonb not null,
  payload_fingerprint text not null check (payload_fingerprint ~ '^[a-f0-9]{64}$'),
  idempotency_key text not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  created_by text not null,
  unique(actor_type,actor_id,idempotency_key),
  unique(supersedes_milestone_id)
);
create index research_validation_milestone_current_idx on research_validation_milestones(candidate_membership_id,captured_membership_version,thesis_lineage_id,ordinal desc);

create table research_review_snapshots (
  id uuid primary key default gen_random_uuid(),
  ordinal bigserial unique,
  candidate_membership_id bigint not null references candidate_memberships(id) on delete restrict,
  captured_membership_version integer not null check (captured_membership_version > 0),
  symbol text not null,
  actor_type text not null,
  actor_id text not null,
  baseline_id uuid not null references research_baseline_snapshots(id) on delete restrict,
  milestone_id uuid not null references research_validation_milestones(id) on delete restrict,
  original_thesis_identity jsonb not null,
  thesis_lineage_id text not null,
  trigger_fingerprint text not null check (trigger_fingerprint ~ '^[a-f0-9]{64}$'),
  thesis_action_id text not null,
  payload jsonb not null,
  payload_fingerprint text not null check (payload_fingerprint ~ '^[a-f0-9]{64}$'),
  idempotency_key text not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  created_by text not null,
  unique(actor_type,actor_id,idempotency_key),
  unique(candidate_membership_id,captured_membership_version,milestone_id,trigger_fingerprint)
);
create index research_review_latest_idx on research_review_snapshots(candidate_membership_id,captured_membership_version,thesis_lineage_id,ordinal desc);

create trigger research_validation_milestones_append_only before update or delete on research_validation_milestones for each row execute function reject_research_underwriting_mutation();
create trigger research_review_snapshots_append_only before update or delete on research_review_snapshots for each row execute function reject_research_underwriting_mutation();
