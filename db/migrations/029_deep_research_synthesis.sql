alter table deep_research_reports
  drop constraint if exists deep_research_reports_contract_version_check;

alter table deep_research_reports
  add constraint deep_research_reports_contract_version_check
  check (
    report_contract_version is null
    or report_contract_version in (
      '2026-07-30.s1e-evidence-bound-two-layer-report.v1',
      '2026-08-05.deep-research-synthesis-report.v1'
    )
  );

alter table deep_research_reports
  drop constraint if exists deep_research_reports_fingerprint_check;

alter table deep_research_reports
  add constraint deep_research_reports_fingerprint_check
  check (
    (report_contract_version is null and report_fingerprint is null)
    or (
      report_contract_version in (
        '2026-07-30.s1e-evidence-bound-two-layer-report.v1',
        '2026-08-05.deep-research-synthesis-report.v1'
      )
      and report_fingerprint ~ '^[a-f0-9]{64}$'
    )
  );

alter table deep_research_tasks
  drop constraint if exists deep_research_tasks_generation_method_check;

alter table deep_research_tasks
  alter column generation_method set default 'deepseek_chat_completions_selected_snapshot';

alter table deep_research_tasks
  add constraint deep_research_tasks_generation_method_check
  check (generation_method in (
    'deterministic_frozen_fact_framework',
    'deepseek_chat_completions_selected_snapshot'
  ));

alter table deep_research_tasks
  drop constraint if exists deep_research_tasks_model_usage_check;

alter table deep_research_tasks
  alter column model_usage set default 'UNKNOWN';

alter table deep_research_tasks
  add constraint deep_research_tasks_model_usage_check
  check (length(trim(model_usage)) between 1 and 500);
