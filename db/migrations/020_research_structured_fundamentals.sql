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
    'evidence_pack_frozen',
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
      'evidence_pack_frozen',
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

create table research_fundamental_values (
  id bigserial primary key,
  candidate_membership_id bigint not null references candidate_memberships(id) on delete restrict,
  captured_membership_version integer not null check (captured_membership_version > 0),
  source_material_id bigint not null,
  metric text not null check (metric in (
    'revenue',
    'profit_attributable_to_owners',
    'operating_cash_flow',
    'total_assets',
    'total_liabilities'
  )),
  period_kind text not null check (period_kind in ('duration', 'instant')),
  period_start date,
  period_end date not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  unit_scale bigint not null check (unit_scale in (1, 1000, 1000000, 1000000000)),
  scope text not null check (scope in ('consolidated', 'parent_company')),
  value_status text not null check (value_status in ('reported', 'explicit_unknown')),
  reported_value numeric(36, 6),
  comparability text not null check (comparability in ('comparable', 'not_comparable')),
  comparability_reason text,
  amendment_kind text not null check (amendment_kind in ('initial', 'restatement', 'correction')),
  replaces_value_id bigint,
  revision integer not null check (revision > 0),
  fact_kind text not null default 'issuer_reported' check (fact_kind = 'issuer_reported'),
  transcription_method text not null default 'owner_manual' check (transcription_method = 'owner_manual'),
  verification_status text not null default 'unverified' check (verification_status = 'unverified'),
  created_at timestamptz not null default now(),
  constraint research_fundamental_values_period_check check (
    (period_kind = 'duration' and period_start is not null and period_start < period_end)
    or (period_kind = 'instant' and period_start is null)
  ),
  constraint research_fundamental_values_value_check check (
    (value_status = 'reported' and reported_value is not null)
    or (value_status = 'explicit_unknown' and reported_value is null)
  ),
  constraint research_fundamental_values_comparability_reason_check check (
    (comparability = 'comparable' and comparability_reason is null)
    or (
      comparability = 'not_comparable'
      and length(trim(comparability_reason)) between 1 and 500
    )
  ),
  constraint research_fundamental_values_amendment_check check (
    (replaces_value_id is null and amendment_kind = 'initial' and revision = 1)
    or (replaces_value_id is not null and amendment_kind in ('restatement', 'correction') and revision > 1)
  ),
  constraint research_fundamental_values_id_membership_source_unique
    unique (id, candidate_membership_id, source_material_id),
  constraint research_fundamental_values_source_membership_fk
    foreign key (source_material_id, candidate_membership_id)
    references research_materials (id, candidate_membership_id)
    on delete restrict,
  constraint research_fundamental_values_replacement_chain_fk
    foreign key (replaces_value_id, candidate_membership_id, source_material_id)
    references research_fundamental_values (id, candidate_membership_id, source_material_id)
    on delete restrict
);

create unique index research_fundamental_values_single_successor_idx
  on research_fundamental_values (replaces_value_id)
  where replaces_value_id is not null;

create unique index research_fundamental_values_source_initial_identity_idx
  on research_fundamental_values (
    candidate_membership_id,
    source_material_id,
    metric,
    period_kind,
    coalesce(period_start, period_end),
    period_end,
    currency,
    unit_scale,
    scope
  )
  where replaces_value_id is null;

create index research_fundamental_values_membership_created_idx
  on research_fundamental_values (candidate_membership_id, created_at asc, id asc);

create or replace function enforce_research_fundamental_replacement()
returns trigger
language plpgsql
as $$
declare
  prior research_fundamental_values%rowtype;
begin
  if new.replaces_value_id is null then
    return new;
  end if;
  select *
    into prior
    from research_fundamental_values
   where id = new.replaces_value_id
   for update;
  if not found
    or prior.candidate_membership_id <> new.candidate_membership_id
    or prior.source_material_id <> new.source_material_id
    or prior.metric <> new.metric
    or prior.period_kind <> new.period_kind
    or prior.period_start is distinct from new.period_start
    or prior.period_end <> new.period_end
    or prior.currency <> new.currency
    or prior.unit_scale <> new.unit_scale
    or prior.scope <> new.scope
    or prior.revision + 1 <> new.revision then
    raise exception 'fundamental replacement must preserve its membership, source, period, metric, scope, currency, and unit chain'
      using errcode = '23514';
  end if;
  if exists (
    select 1 from research_fundamental_values
     where replaces_value_id = prior.id
  ) then
    raise exception 'fundamental value already has a successor'
      using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger research_fundamental_values_replacement_guard
before insert on research_fundamental_values
for each row execute function enforce_research_fundamental_replacement();

create or replace function reject_research_fundamental_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'research fundamental values are append-only';
end;
$$;

create trigger research_fundamental_values_append_only
before update or delete on research_fundamental_values
for each row execute function reject_research_fundamental_mutation();
