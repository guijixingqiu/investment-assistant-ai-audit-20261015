alter table research_events
  add column if not exists monitor_rule_binding jsonb;

alter table research_events
  drop constraint if exists research_events_monitor_rule_binding_check;

alter table research_events
  add constraint research_events_monitor_rule_binding_check
  check (monitor_rule_binding is null or jsonb_typeof(monitor_rule_binding) = 'object');
