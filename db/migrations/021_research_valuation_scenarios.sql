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
    'research_valuation_scenario_created',
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
      'research_valuation_scenario_created',
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

alter table research_fundamental_values
  add constraint research_fundamental_values_id_membership_unique
  unique (id, candidate_membership_id);

create table research_valuation_scenario_sets (
  id bigserial primary key,
  candidate_membership_id bigint not null references candidate_memberships(id) on delete restrict,
  captured_membership_version integer not null check (captured_membership_version > 0),
  anchor_value_id bigint not null,
  replaces_scenario_set_id bigint,
  revision integer not null check (revision > 0),
  assumption_payload jsonb not null check (jsonb_typeof(assumption_payload) = 'object'),
  calculation_version text not null
    check (calculation_version = '2026-07-17.discounted-forward-metric-multiple.v1'),
  calculation_payload jsonb not null check (jsonb_typeof(calculation_payload) = 'object'),
  created_at timestamptz not null default now(),
  constraint research_valuation_scenario_sets_replacement_revision_check check (
    (replaces_scenario_set_id is null and revision = 1)
    or (replaces_scenario_set_id is not null and revision > 1)
  ),
  constraint research_valuation_scenario_sets_id_membership_unique
    unique (id, candidate_membership_id),
  constraint research_valuation_scenario_sets_anchor_membership_fk
    foreign key (anchor_value_id, candidate_membership_id)
    references research_fundamental_values (id, candidate_membership_id)
    on delete restrict,
  constraint research_valuation_scenario_sets_replacement_membership_fk
    foreign key (replaces_scenario_set_id, candidate_membership_id)
    references research_valuation_scenario_sets (id, candidate_membership_id)
    on delete restrict
);

create unique index research_valuation_scenario_sets_single_successor_idx
  on research_valuation_scenario_sets (replaces_scenario_set_id)
  where replaces_scenario_set_id is not null;

create unique index research_valuation_scenario_sets_single_root_idx
  on research_valuation_scenario_sets (candidate_membership_id, anchor_value_id)
  where replaces_scenario_set_id is null;

create index research_valuation_scenario_sets_membership_created_idx
  on research_valuation_scenario_sets (candidate_membership_id, created_at desc, id desc);

create or replace function enforce_research_valuation_scenario_replacement()
returns trigger
language plpgsql
as $$
declare
  prior research_valuation_scenario_sets%rowtype;
begin
  if new.replaces_scenario_set_id is null then
    return new;
  end if;
  select *
    into prior
    from research_valuation_scenario_sets
   where id = new.replaces_scenario_set_id
   for update;
  if not found
    or prior.candidate_membership_id <> new.candidate_membership_id
    or prior.anchor_value_id <> new.anchor_value_id
    or prior.revision + 1 <> new.revision then
    raise exception 'valuation scenario replacement must preserve membership and anchor with the next revision'
      using errcode = '23514';
  end if;
  if exists (
    select 1 from research_valuation_scenario_sets
     where replaces_scenario_set_id = prior.id
  ) then
    raise exception 'valuation scenario set already has a successor'
      using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger research_valuation_scenario_sets_replacement_guard
before insert on research_valuation_scenario_sets
for each row execute function enforce_research_valuation_scenario_replacement();

create or replace function reject_research_valuation_scenario_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'research valuation scenario sets are append-only';
end;
$$;

create trigger research_valuation_scenario_sets_append_only
before update or delete on research_valuation_scenario_sets
for each row execute function reject_research_valuation_scenario_mutation();
