-- Owner-checked fiscal filing requirements; each version binds exact saved originals.
create table if not exists research_financial_requirements (
  id bigserial primary key,
  candidate_membership_id bigint not null references candidate_memberships(id) on delete restrict,
  membership_version integer not null check (membership_version > 0),
  actor_type text not null check (actor_type = 'user'),
  actor_id text not null check (length(actor_id) > 0),
  symbol text not null check (symbol ~ '^HK\.[0-9]{5}$'),
  version integer not null check (version > 0),
  base_requirement_id bigint references research_financial_requirements(id) on delete restrict,
  fiscal_year_end text not null check (fiscal_year_end ~ '^[0-9]{2}-[0-9]{2}$'),
  latest_required_annual_period_end date not null,
  latest_required_interim_period_start date not null,
  latest_required_interim_period_end date not null,
  as_of timestamptz not null,
  next_review_at timestamptz not null,
  valid_until timestamptz not null,
  sources jsonb not null check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) between 1 and 4),
  owner_confirmed boolean not null check (owner_confirmed),
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  check (next_review_at > as_of and valid_until <= next_review_at),
  check (latest_required_interim_period_start <= latest_required_interim_period_end),
  unique (candidate_membership_id, version),
  unique (actor_type, actor_id, idempotency_key),
  unique (id, candidate_membership_id)
);
create index if not exists research_financial_requirements_current_idx
  on research_financial_requirements(candidate_membership_id, version desc);
create or replace function reject_research_financial_requirement_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'research financial requirements are append-only';
end;
$$;
drop trigger if exists research_financial_requirements_append_only on research_financial_requirements;
create trigger research_financial_requirements_append_only
before update or delete on research_financial_requirements
for each row execute function reject_research_financial_requirement_mutation();
