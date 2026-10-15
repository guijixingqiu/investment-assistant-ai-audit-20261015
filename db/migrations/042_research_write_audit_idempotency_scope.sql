alter table research_write_audit_events
  drop constraint if exists research_write_audit_events_idempotency_key_key;

alter table research_write_audit_events
  add constraint research_write_audit_events_event_idempotency_key_key
  unique (event_type, idempotency_key);
