alter table research_valuation_scenario_sets
  drop constraint research_valuation_scenario_sets_calculation_version_check;

alter table research_valuation_scenario_sets
  add constraint research_valuation_scenario_sets_calculation_version_check
  check (calculation_version in (
    '2026-07-17.discounted-forward-metric-multiple.v1',
    '2026-08-13.adjusted-net-asset-value.v1'
  ));
