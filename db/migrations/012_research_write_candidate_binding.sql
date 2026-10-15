alter table research_write_audit_events
  add column if not exists request_fingerprint text,
  add column if not exists candidate_membership_id bigint references candidate_memberships(id),
  add column if not exists candidate_membership_version integer;

alter table research_write_audit_events
  drop constraint if exists research_write_audit_events_candidate_binding_check;

alter table research_write_audit_events
  add constraint research_write_audit_events_candidate_binding_check
  check (
    event_type not in ('profile_updated', 'evidence_created')
    or (
      request_fingerprint is not null
      and candidate_membership_id is not null
      and candidate_membership_version is not null
      and candidate_membership_version > 0
    )
  ) not valid;
