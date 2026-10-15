-- Source inputs for the explicitly defined operating-profit calculation.
alter table research_fundamental_values drop constraint research_fundamental_values_metric_check;
alter table research_fundamental_values add constraint research_fundamental_values_metric_check check (metric in (
  'revenue',
  'profit_attributable_to_owners',
  'operating_cash_flow',
  'total_assets',
  'total_liabilities',
  'sales_volume',
  'average_selling_price',
  'product_mix_volume',
  'sales_volume_yoy',
  'shares_outstanding',
  'issued_shares',
  'treasury_shares',
  'gross_profit',
  'gross_margin',
  'research_and_development_expense',
  'selling_and_distribution_expense',
  'administrative_expense',
  'operating_profit',
  'profit_before_tax',
  'net_finance_income',
  'associates_profit',
  'joint_ventures_profit',
  'capital_expenditure',
  'core_profit_attributable_to_owners',
  'property_plant_equipment_purchases',
  'intangible_asset_purchases',
  'land_lease_prepayments',
  'fx_effect',
  'non_financial_impairment'));

alter table research_fundamental_values drop constraint research_fundamental_values_verification_status_check;
alter table research_fundamental_values add constraint research_fundamental_values_verification_status_check check (
 verification_status in ('unverified','verified','owner_confirmed') or
 (verification_status='source_text_verified' and assertion_metadata->'textBinding' is not null));
alter table research_fundamental_values drop constraint research_fundamental_assertion_shape;
alter table research_fundamental_values add constraint research_fundamental_assertion_shape check (
 assertion_metadata is null or (jsonb_typeof(assertion_metadata)='object'
 and assertion_metadata->>'category' in ('actual','guidance')
 and assertion_metadata->>'unit' in ('currency','currency_per_vehicle','vehicles','ratio','shares')
 and length(assertion_metadata->>'limitation')>0 and assertion_metadata->>'sourceUrl' like 'https://%'));
