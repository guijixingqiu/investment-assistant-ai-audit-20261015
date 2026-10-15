create table if not exists cloud_ai_provider_policy_events (
  id bigserial primary key,
  actor_type text not null check (actor_type = 'user'),
  actor_id text not null,
  provider text not null check (provider = 'deepseek'),
  model text not null check (model = 'deepseek-v4-flash'),
  policy_version text not null,
  action text not null check (action in ('enable', 'disable', 'request_deletion')),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (actor_type, actor_id, idempotency_key)
);

create index if not exists cloud_ai_provider_policy_events_actor_created_idx
  on cloud_ai_provider_policy_events (actor_type, actor_id, created_at desc, id desc);

create or replace function reject_cloud_ai_provider_policy_event_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'cloud AI provider policy events are append-only';
end;
$$;

drop trigger if exists cloud_ai_provider_policy_events_append_only on cloud_ai_provider_policy_events;
create trigger cloud_ai_provider_policy_events_append_only
before update or delete on cloud_ai_provider_policy_events
for each row execute function reject_cloud_ai_provider_policy_event_mutation();

comment on table cloud_ai_provider_policy_events is
  'Append-only Owner authorization, revocation, and provider-deletion request status. No prompt body or credential is stored.';
