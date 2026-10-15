-- Provider FCFF reuses the existing scenario table and provider source references.
-- Its source is a third-party original, distinct from issuer facts and provider PE.
alter table research_valuation_scenario_sets
  drop constraint research_valuation_scenario_basis_exclusive;

alter table research_valuation_scenario_sets
  add constraint research_valuation_scenario_basis_exclusive check (
    (basis_kind = 'issuer' and anchor_value_id is not null
      and provider_financial_capture_id is null and provider_valuation_capture_id is null
      and provider_source_material_id is null and provider_basis is null)
    or (basis_kind = 'provider' and anchor_value_id is null
      and provider_financial_capture_id is not null and provider_source_material_id is not null
      and jsonb_typeof(provider_basis) = 'object' and (
        (provider_valuation_capture_id is not null
          and calculation_version <> '2026-10-12.discounted-fcff-to-common-equity.v2'
          and (provider_basis #>> '{eps,basis}') in ('basic', 'diluted')
          and (provider_basis #>> '{eps,periodEnd}') ~ '^20[0-9]{2}-12-31$')
        or (provider_valuation_capture_id is null
          and calculation_version = '2026-10-12.discounted-fcff-to-common-equity.v2'
          and provider_basis ->> 'kind' = 'provider_fcff'
          and provider_basis ->> 'sourceClassification' = 'third_party_statement'
          and (provider_basis ->> 'balanceReferenceDate') ~ '^20[0-9]{2}-12-31$')
      ))
  );

create unique index research_valuation_provider_fcff_single_root_idx
  on research_valuation_scenario_sets(candidate_membership_id, provider_financial_capture_id,
    provider_source_material_id, (provider_basis ->> 'balanceReferenceDate'))
  where basis_kind = 'provider'
    and calculation_version = '2026-10-12.discounted-fcff-to-common-equity.v2'
    and replaces_scenario_set_id is null;

-- A current provider FCFF revision may replace an older one with a newly checked
-- capture/material. PE and issuer replacements retain their exact-source rule.
create or replace function enforce_research_valuation_scenario_replacement()
returns trigger language plpgsql as $$
declare prior research_valuation_scenario_sets%rowtype;
begin
  if new.replaces_scenario_set_id is null then return new; end if;
  select * into prior from research_valuation_scenario_sets where id = new.replaces_scenario_set_id for update;
  if not found or prior.candidate_membership_id <> new.candidate_membership_id
    or prior.basis_kind <> new.basis_kind
    or ((prior.calculation_version = '2026-10-12.discounted-fcff-to-common-equity.v2'
      or new.calculation_version = '2026-10-12.discounted-fcff-to-common-equity.v2')
      and prior.calculation_version <> new.calculation_version)
    or prior.anchor_value_id is distinct from new.anchor_value_id
    or ((prior.basis_kind <> 'provider'
      or prior.calculation_version <> '2026-10-12.discounted-fcff-to-common-equity.v2')
      and (prior.provider_financial_capture_id is distinct from new.provider_financial_capture_id
        or prior.provider_valuation_capture_id is distinct from new.provider_valuation_capture_id
        or prior.provider_source_material_id is distinct from new.provider_source_material_id
        or prior.provider_basis is distinct from new.provider_basis))
    or prior.revision + 1 <> new.revision then
    raise exception 'valuation scenario replacement must preserve member and allowed source basis'
      using errcode = '23514';
  end if;
  if exists(select 1 from research_valuation_scenario_sets where replaces_scenario_set_id = prior.id) then
    raise exception 'valuation scenario set already has a successor' using errcode = '23505';
  end if;
  return new;
end;
$$;
