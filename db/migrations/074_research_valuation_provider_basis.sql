-- Provider observations remain separate from issuer fundamental values and formal valuation anchors.
create table research_futu_valuation_captures (
  id bigserial primary key,
  candidate_membership_id bigint not null references candidate_memberships(id) on delete restrict,
  captured_membership_version integer not null check (captured_membership_version > 0),
  actor_type text not null check (actor_type = 'user'),
  actor_id text not null check (length(actor_id) between 1 and 200),
  symbol text not null check (symbol ~ '^HK\.[0-9]{5}$'),
  valuation_type text not null check (valuation_type in ('PE','PB')),
  interval_type text not null check (interval_type = 'YEAR_5'),
  captured_at timestamptz not null,
  provider_updated_at timestamptz not null,
  raw_sha256 text not null check (raw_sha256 ~ '^[a-f0-9]{64}$'),
  byte_length integer not null check (byte_length between 1 and 524288),
  current_value double precision not null check (current_value > 0),
  historical_average double precision not null check (historical_average > 0),
  historical_percentile double precision not null check (historical_percentile between 0 and 100),
  historical_count integer not null check (historical_count between 2 and 1600),
  first_historical_date date not null,
  last_historical_date date not null,
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  unique(actor_type,actor_id,idempotency_key),
  unique(id,candidate_membership_id,captured_membership_version)
);
create index research_futu_valuation_capture_member_idx
  on research_futu_valuation_captures(candidate_membership_id,captured_at desc,id desc);
create trigger research_futu_valuation_captures_append_only
before update or delete on research_futu_valuation_captures
for each row execute function reject_research_futu_financial_capture_mutation();

alter table research_futu_financial_statement_captures
  add constraint research_futu_financial_capture_member_version_unique
  unique(id,candidate_membership_id,captured_membership_version);

alter table research_valuation_scenario_sets
  alter column anchor_value_id drop not null,
  add column basis_kind text not null default 'issuer' check (basis_kind in ('issuer','provider')),
  add column provider_financial_capture_id bigint,
  add column provider_valuation_capture_id bigint,
  add column provider_source_material_id bigint,
  add column provider_basis jsonb,
  add constraint research_valuation_scenario_basis_exclusive check (
    (basis_kind='issuer' and anchor_value_id is not null and provider_financial_capture_id is null
      and provider_valuation_capture_id is null and provider_source_material_id is null and provider_basis is null)
    or (basis_kind='provider' and anchor_value_id is null and provider_financial_capture_id is not null
      and provider_valuation_capture_id is not null and provider_source_material_id is not null
      and jsonb_typeof(provider_basis)='object'
      and (provider_basis #>> '{eps,basis}') in ('basic','diluted')
      and (provider_basis #>> '{eps,periodEnd}') ~ '^20[0-9]{2}-12-31$')
  ),
  add constraint research_valuation_provider_financial_fk
    foreign key(provider_financial_capture_id,candidate_membership_id,captured_membership_version)
    references research_futu_financial_statement_captures(id,candidate_membership_id,captured_membership_version) on delete restrict,
  add constraint research_valuation_provider_valuation_fk
    foreign key(provider_valuation_capture_id,candidate_membership_id,captured_membership_version)
    references research_futu_valuation_captures(id,candidate_membership_id,captured_membership_version) on delete restrict,
  add constraint research_valuation_provider_material_fk
    foreign key(provider_source_material_id) references research_materials(id) on delete restrict;

create unique index research_valuation_provider_single_root_idx
  on research_valuation_scenario_sets(candidate_membership_id,provider_financial_capture_id,
    provider_valuation_capture_id,provider_source_material_id,
    (provider_basis #>> '{eps,periodEnd}'),(provider_basis #>> '{eps,basis}'))
  where basis_kind='provider' and replaces_scenario_set_id is null;

create or replace function enforce_research_valuation_scenario_replacement()
returns trigger language plpgsql as $$
declare prior research_valuation_scenario_sets%rowtype;
begin
  if new.replaces_scenario_set_id is null then return new; end if;
  select * into prior from research_valuation_scenario_sets where id=new.replaces_scenario_set_id for update;
  if not found or prior.candidate_membership_id<>new.candidate_membership_id
    or prior.basis_kind<>new.basis_kind
    or prior.anchor_value_id is distinct from new.anchor_value_id
    or prior.provider_financial_capture_id is distinct from new.provider_financial_capture_id
    or prior.provider_valuation_capture_id is distinct from new.provider_valuation_capture_id
    or prior.provider_source_material_id is distinct from new.provider_source_material_id
    or prior.provider_basis is distinct from new.provider_basis
    or prior.revision+1<>new.revision then
    raise exception 'valuation scenario replacement must preserve membership and exact source basis'
      using errcode='23514';
  end if;
  if exists(select 1 from research_valuation_scenario_sets where replaces_scenario_set_id=prior.id) then
    raise exception 'valuation scenario set already has a successor' using errcode='23505';
  end if;
  return new;
end;
$$;
