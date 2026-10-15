alter table pre_trade_decision_checks
  add column if not exists decision_context_snapshot jsonb;

alter table research_write_audit_events
  drop constraint if exists research_write_audit_events_event_type_check;

alter table research_write_audit_events
  add constraint research_write_audit_events_event_type_check
  check (event_type in ('profile_updated', 'evidence_created', 'decision_check_created', 'post_decision_review_created'));

create table if not exists post_decision_reviews (
  id bigserial primary key,
  decision_check_id bigint not null references pre_trade_decision_checks(id),
  actor_type text not null check (actor_type in ('user', 'system', 'migration', 'test')),
  actor_id text,
  outcome text not null check (outcome in ('thesis_confirmed', 'thesis_weakened', 'thesis_invalidated', 'insufficient_evidence')),
  outcome_evidence text,
  review_note text,
  reviewed_at timestamptz not null default now(),
  idempotency_key text not null,
  correlation_id text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (idempotency_key)
);

create index if not exists post_decision_reviews_check_created_idx
  on post_decision_reviews (decision_check_id, created_at desc, id desc);

create index if not exists post_decision_reviews_actor_created_idx
  on post_decision_reviews (actor_type, actor_id, created_at desc);
