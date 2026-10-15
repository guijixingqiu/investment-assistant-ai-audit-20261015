alter table pre_trade_decision_checks
  add column if not exists decision_snapshot jsonb;
