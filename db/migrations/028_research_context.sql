create table research_context_snapshots (
  id bigserial primary key,
  candidate_membership_id bigint not null references candidate_memberships(id) on delete restrict,
  captured_membership_version integer not null check (captured_membership_version > 0),
  actor_type text not null check (actor_type in ('user', 'system')),
  actor_id text not null check (length(trim(actor_id)) between 1 and 200),
  selected_symbol text not null check (selected_symbol ~ '^HK\.[0-9]{5}$'),
  industry text not null check (length(trim(industry)) between 1 and 200),
  as_of timestamptz not null,
  cutoff_at timestamptz not null,
  valid_until timestamptz not null,
  context_payload jsonb not null check (jsonb_typeof(context_payload) = 'object'),
  idempotency_key text not null check (length(trim(idempotency_key)) between 1 and 200),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (actor_type, actor_id, idempotency_key),
  check (cutoff_at <= as_of and valid_until > as_of),
  check (context_payload->>'selectedSymbol' = selected_symbol),
  check (context_payload->>'industry' = industry)
);

create index research_context_snapshots_membership_cutoff_idx
  on research_context_snapshots (candidate_membership_id, actor_type, actor_id, cutoff_at desc, id desc);

create or replace function reject_research_context_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'research context snapshots are append-only';
end;
$$;

create trigger research_context_snapshots_append_only
before update or delete on research_context_snapshots
for each row execute function reject_research_context_mutation();
