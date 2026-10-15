alter table deep_research_tasks
  drop constraint if exists deep_research_tasks_status_check;

alter table deep_research_tasks
  add constraint deep_research_tasks_status_check
  check (status in ('pending', 'running', 'ready_to_absorb', 'succeeded', 'failed'));

alter table deep_research_tasks
  drop constraint if exists deep_research_tasks_check;

alter table deep_research_tasks
  add constraint deep_research_tasks_state_check
  check (
    (status = 'pending' and claim_token is null and report_id is null and completed_at is null and lease_expires_at is null)
    or (status = 'running' and claim_token is not null and attempt_count > 0 and report_id is null and completed_at is null and lease_expires_at is not null)
    or (status = 'ready_to_absorb' and claim_token is null and report_id is null and completed_at is not null and lease_expires_at is null and error_code is null)
    or (status = 'succeeded' and claim_token is null and report_id is not null and completed_at is not null and lease_expires_at is null and error_code is null)
    or (status = 'failed' and claim_token is null and report_id is null and completed_at is not null and lease_expires_at is null and error_code is not null)
  );
