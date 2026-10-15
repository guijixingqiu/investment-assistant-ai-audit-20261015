alter table cloud_ai_provider_policy_events
  add column if not exists backup_provider text;

alter table cloud_ai_provider_policy_events
  drop constraint if exists cloud_ai_provider_policy_events_backup_provider_check;

alter table cloud_ai_provider_policy_events
  add constraint cloud_ai_provider_policy_events_backup_provider_check
  check (backup_provider is null or backup_provider = 'none');
