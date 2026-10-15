create table if not exists research_write_audit_events (
  id bigserial primary key,
  event_type text not null check (event_type in ('profile_updated', 'evidence_created', 'decision_check_created')),
  actor_type text not null check (actor_type in ('user', 'system', 'migration', 'test')),
  actor_id text,
  stock_id bigint references stocks(id),
  market text,
  code text,
  symbol text,
  target_table text not null,
  target_id text not null,
  idempotency_key text,
  before_payload jsonb,
  after_payload jsonb not null default '{}'::jsonb,
  correlation_id text,
  created_at timestamptz not null default now(),
  unique (idempotency_key)
);

create index if not exists research_write_audit_events_symbol_created_idx
  on research_write_audit_events (market, code, created_at desc);

create index if not exists research_write_audit_events_type_created_idx
  on research_write_audit_events (event_type, created_at desc);
