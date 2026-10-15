create table research_completeness_snapshots (
  id bigserial primary key,
  candidate_membership_id bigint not null references candidate_memberships(id) on delete restrict,
  captured_membership_version integer not null check (captured_membership_version > 0),
  actor_id text not null check (length(trim(actor_id)) between 1 and 200),
  symbol text not null check (symbol ~ '^HK\.[0-9]{5}$'),
  source_payload jsonb not null check (jsonb_typeof(source_payload) = 'object'),
  valid_until timestamptz not null,
  idempotency_key text not null check (length(trim(idempotency_key)) between 1 and 200),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (actor_id, idempotency_key),
  check (valid_until > created_at)
);

create index research_completeness_membership_latest_idx
  on research_completeness_snapshots (candidate_membership_id, actor_id, id desc);

create or replace function reject_research_completeness_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'research completeness snapshots are append-only';
end;
$$;

create trigger research_completeness_snapshots_append_only
before update or delete on research_completeness_snapshots
for each row execute function reject_research_completeness_mutation();
