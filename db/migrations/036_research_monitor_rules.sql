alter table research_profiles
  add column if not exists monitor_rules jsonb not null default '[]'::jsonb
  check (jsonb_typeof(monitor_rules) = 'array');

comment on column research_profiles.monitor_rules is
  'Owner-confirmed advisory research monitoring rules. Configuration only; no scheduler, trading, or portfolio authority.';
