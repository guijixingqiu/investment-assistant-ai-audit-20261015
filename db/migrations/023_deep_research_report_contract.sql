alter table deep_research_reports
  add column if not exists report_contract_version text;

alter table deep_research_reports
  add column if not exists report_fingerprint text;

alter table deep_research_reports
  drop constraint if exists deep_research_reports_contract_version_check;

alter table deep_research_reports
  add constraint deep_research_reports_contract_version_check
  check (
    report_contract_version is null
    or report_contract_version = '2026-07-30.s1e-evidence-bound-two-layer-report.v1'
  );

alter table deep_research_reports
  drop constraint if exists deep_research_reports_fingerprint_check;

alter table deep_research_reports
  add constraint deep_research_reports_fingerprint_check
  check (
    (report_contract_version is null and report_fingerprint is null)
    or (
      report_contract_version = '2026-07-30.s1e-evidence-bound-two-layer-report.v1'
      and report_fingerprint ~ '^[a-f0-9]{64}$'
    )
  );

create or replace function reject_deep_research_report_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'deep research reports are append-only';
end;
$$;

drop trigger if exists deep_research_reports_append_only on deep_research_reports;
create trigger deep_research_reports_append_only
before update or delete on deep_research_reports
for each row execute function reject_deep_research_report_mutation();
