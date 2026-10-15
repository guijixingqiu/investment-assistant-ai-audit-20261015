-- Preserve the Phase 11 FY / next-reporting-period identity in Phase 12 history.
-- Existing immutable Phase 12 rows were created by the FY-only implementation.
alter table research_validation_milestones
  add column scenario_period_type text not null default 'CURRENT_FY'
  check (scenario_period_type in ('CURRENT_FY','NEXT_REPORTING_PERIOD'));

alter table research_review_snapshots
  add column scenario_period_type text not null default 'CURRENT_FY'
  check (scenario_period_type in ('CURRENT_FY','NEXT_REPORTING_PERIOD'));
