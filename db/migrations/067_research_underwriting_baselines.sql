-- Phase 11 uses the existing Research DB and actor/membership identity. Every version is immutable.
create table research_underwriting_scenario_versions (
  id bigserial primary key,
  candidate_membership_id bigint not null references candidate_memberships(id) on delete restrict,
  captured_membership_version integer not null check (captured_membership_version>0),
  symbol text not null,
  actor_type text not null,
  actor_id text not null,
  scenario_period_type text not null check (scenario_period_type in ('CURRENT_FY','NEXT_REPORTING_PERIOD')),
  period_start date not null,
  period_end date not null,
  version integer not null check (version>0),
  parent_version_id bigint references research_underwriting_scenario_versions(id) on delete restrict,
  context_id bigint not null references research_context_snapshots(id) on delete restrict,
  model_fingerprint text not null check (model_fingerprint ~ '^[a-f0-9]{64}$'),
  model_payload jsonb not null,
  assumptions_payload jsonb not null,
  calculation_version text not null,
  change_reason text not null,
  idempotency_key text not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique(candidate_membership_id,captured_membership_version,scenario_period_type,period_start,period_end,version),
  unique(actor_type,actor_id,idempotency_key)
);
create index research_underwriting_current_base_idx on research_underwriting_scenario_versions(candidate_membership_id,captured_membership_version,scenario_period_type,period_start,period_end,version desc);
create table research_baseline_snapshots (
  id uuid primary key default gen_random_uuid(),
  candidate_membership_id bigint not null references candidate_memberships(id) on delete restrict,
  captured_membership_version integer not null check (captured_membership_version>0),
  symbol text not null,
  actor_type text not null,
  actor_id text not null,
  scenario_version_id bigint not null references research_underwriting_scenario_versions(id) on delete restrict,
  snapshot_payload jsonb not null,
  snapshot_fingerprint text not null check (snapshot_fingerprint ~ '^[a-f0-9]{64}$'),
  idempotency_key text not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique(actor_type,actor_id,idempotency_key)
);
create index research_baseline_membership_created_idx on research_baseline_snapshots(candidate_membership_id,captured_membership_version,created_at desc);
create or replace function reject_research_underwriting_mutation() returns trigger language plpgsql as $$ begin raise exception 'research underwriting history is append-only'; end $$;
create trigger research_scenario_versions_append_only before update or delete on research_underwriting_scenario_versions for each row execute function reject_research_underwriting_mutation();
create trigger research_baselines_append_only before update or delete on research_baseline_snapshots for each row execute function reject_research_underwriting_mutation();
