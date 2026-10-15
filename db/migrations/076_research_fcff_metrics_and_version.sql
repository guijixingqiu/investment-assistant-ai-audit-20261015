-- R80: admit exact issuer-reported raw rows and the separate FCFF calculation version.
-- This changes only the two existing CHECK allowlists. Existing values remain admitted.
alter table research_fundamental_values
  drop constraint research_fundamental_values_metric_check;

alter table research_fundamental_values
  add constraint research_fundamental_values_metric_check check (metric in (
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
    'non_financial_impairment',
    'deemed_disposal_gain',
    'depreciation_amortization',
    'cash_and_cash_equivalents',
    'bank_borrowings',
    'bonds_current',
    'bonds_noncurrent',
    'lease_liabilities_current',
    'lease_liabilities_noncurrent',
    'restricted_deposits',
    'structured_deposits',
    'fvoci_financial_assets',
    'associate_investments',
    'joint_venture_investments',
    'joint_venture_loans',
    'noncontrolling_interests',
    'derivative_liabilities',
    'nci_dividend_payable',
    'parent_dividend_payable',
    'trade_receivables',
    'inventories',
    'prepayments_and_other_operating_receivables',
    'trade_payables',
    'contract_liabilities',
    'accrued_operating_liabilities'
  ));

alter table research_valuation_scenario_sets
  drop constraint research_valuation_scenario_sets_calculation_version_check;

alter table research_valuation_scenario_sets
  add constraint research_valuation_scenario_sets_calculation_version_check
  check (calculation_version in (
    '2026-07-17.discounted-forward-metric-multiple.v1',
    '2026-08-13.adjusted-net-asset-value.v1',
    '2026-10-12.discounted-fcff-to-common-equity.v2'
  ));
