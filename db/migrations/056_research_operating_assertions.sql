-- Compatible extension of existing append-only facts; no new fact store.
alter table research_fundamental_values add column assertion_metadata jsonb;
alter table research_fundamental_values drop constraint research_fundamental_values_metric_check;
alter table research_fundamental_values add constraint research_fundamental_values_metric_check check (metric in (
  'revenue',
  'profit_attributable_to_owners',
  'operating_cash_flow',
  'total_assets',
  'total_liabilities',
  'sales_volume',
  'sales_volume_yoy',
  'issued_shares',
  'treasury_shares',
  'shares_outstanding',
  'gross_profit',
  'gross_margin',
  'research_and_development_expense',
  'selling_and_distribution_expense',
  'administrative_expense',
  'operating_profit',
  'capital_expenditure',
  'core_profit_attributable_to_owners',
  'property_plant_equipment_purchases',
  'intangible_asset_purchases',
  'land_lease_prepayments',
  'fx_effect',
  'non_financial_impairment'));
alter table research_fundamental_values drop constraint research_fundamental_values_verification_status_check;
alter table research_fundamental_values add constraint research_fundamental_values_verification_status_check check (
 verification_status = 'unverified' or
 (verification_status = 'verified' and assertion_metadata is not null
  and assertion_metadata->>'sourceChecked' = 'true')
);
alter table research_fundamental_values add constraint research_fundamental_assertion_shape check (
 assertion_metadata is null or (
 jsonb_typeof(assertion_metadata) = 'object'
 and assertion_metadata->>'category' in ('actual','guidance')
 and assertion_metadata->>'unit' in ('currency','vehicles','ratio','shares')
 and length(assertion_metadata->>'limitation') > 0
 and assertion_metadata->>'sourceUrl' like 'https://%'
 )
);
