create table if not exists research_fixture_seed_events (
  id bigserial primary key,
  fixture_key text not null unique,
  fixture_version text not null,
  provenance text not null check (provenance = 'controlled_test_fixture'),
  actor_type text not null check (actor_type in ('user', 'system')),
  actor_id text not null,
  request_fingerprint text not null,
  research_profile_id bigint references research_profiles(id),
  suggestion_id bigint references ai_update_suggestions(id),
  result_payload jsonb,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (
    (research_profile_id is null and suggestion_id is null and result_payload is null and completed_at is null)
    or
    (research_profile_id is not null and suggestion_id is not null and result_payload is not null and completed_at is not null)
  )
);

create index if not exists research_fixture_seed_events_profile_idx
  on research_fixture_seed_events (research_profile_id, completed_at desc)
  where completed_at is not null;

alter table ai_suggestion_decisions
  add column if not exists actor_type text,
  add column if not exists actor_id text,
  add column if not exists idempotency_key text,
  add column if not exists request_fingerprint text,
  add column if not exists correlation_id text,
  add column if not exists raw_payload jsonb not null default '{}'::jsonb;

update ai_suggestion_decisions
   set actor_type = coalesce(actor_type, 'migration'),
       actor_id = coalesce(actor_id, 'legacy-migration'),
       idempotency_key = coalesce(idempotency_key, 'legacy-ai-suggestion-decision:' || id::text),
       request_fingerprint = coalesce(request_fingerprint, 'legacy-ai-suggestion-decision:' || id::text),
       correlation_id = coalesce(correlation_id, 'ai-suggestion-decision:migration:legacy-migration:legacy-ai-suggestion-decision:' || id::text);

alter table ai_suggestion_decisions
  alter column actor_type set not null,
  alter column actor_id set not null,
  alter column idempotency_key set not null,
  alter column request_fingerprint set not null,
  alter column correlation_id set not null;

alter table ai_suggestion_decisions
  drop constraint if exists ai_suggestion_decisions_actor_type_check;

alter table ai_suggestion_decisions
  add constraint ai_suggestion_decisions_actor_type_check
  check (actor_type in ('user', 'system', 'migration', 'test'));

create unique index if not exists ai_suggestion_decisions_suggestion_uidx
  on ai_suggestion_decisions (suggestion_id);

create unique index if not exists ai_suggestion_decisions_idempotency_key_uidx
  on ai_suggestion_decisions (idempotency_key);

create index if not exists ai_suggestion_decisions_actor_created_idx
  on ai_suggestion_decisions (actor_type, actor_id, created_at desc, id desc);
