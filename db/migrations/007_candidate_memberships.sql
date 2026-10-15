create table if not exists candidate_memberships (
  id bigserial primary key,
  actor_type text not null check (actor_type in ('user', 'system')),
  actor_id text not null,
  market text not null check (market = 'HK'),
  code text not null check (code ~ '^[0-9]{5}$'),
  symbol text not null,
  state text not null check (state in ('tracked', 'paused', 'archived')),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (actor_type, actor_id, market, code),
  check (symbol = market || '.' || code),
  check ((state = 'archived' and archived_at is not null) or (state <> 'archived' and archived_at is null))
);

create index if not exists candidate_memberships_actor_state_idx
  on candidate_memberships (actor_type, actor_id, state, updated_at desc, symbol asc, id desc);

create table if not exists candidate_membership_audit_events (
  id bigserial primary key,
  event_type text not null check (event_type in (
    'membership_created',
    'membership_already_exists',
    'membership_restored',
    'membership_state_changed',
    'membership_state_unchanged',
    'membership_write_rejected'
  )),
  actor_type text not null check (actor_type in ('user', 'system')),
  actor_id text not null,
  membership_id bigint references candidate_memberships(id),
  market text not null,
  code text not null,
  symbol text not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  before_payload jsonb,
  after_payload jsonb,
  failure_reason text,
  retention_class text not null default 'accepted_write' check (retention_class in ('accepted_write', 'rejected_write_safe_metadata')),
  correlation_id text not null,
  created_at timestamptz not null default now(),
  check (
    (
      event_type = 'membership_write_rejected'
      and membership_id is null
      and after_payload is null
      and failure_reason is not null
      and retention_class = 'rejected_write_safe_metadata'
    )
    or (
      event_type <> 'membership_write_rejected'
      and membership_id is not null
      and after_payload is not null
      and failure_reason is null
      and retention_class = 'accepted_write'
    )
  ),
  unique (actor_type, actor_id, idempotency_key)
);

create index if not exists candidate_membership_audit_membership_created_idx
  on candidate_membership_audit_events (membership_id, created_at desc, id desc);
