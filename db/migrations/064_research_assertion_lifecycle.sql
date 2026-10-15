-- Append-only lifecycle events for existing fundamental assertions. Old fact rows are never updated.
create table if not exists research_fundamental_assertion_lifecycle (
 id bigserial primary key,
 candidate_membership_id bigint not null references candidate_memberships(id) on delete restrict,
 captured_membership_version integer not null check (captured_membership_version > 0),
 fundamental_value_id bigint not null references research_fundamental_values(id) on delete restrict,
 status text not null check (status in ('RETRACTED','INVALID')),
 reason text not null check (length(trim(reason)) between 3 and 1000),
 source_material_id bigint references research_materials(id) on delete restrict,
 actor_type text not null,
 actor_id text not null,
 created_at timestamptz not null default now(),
 unique(candidate_membership_id,fundamental_value_id,status)
);
create index if not exists research_fundamental_lifecycle_fact_idx on research_fundamental_assertion_lifecycle(fundamental_value_id,created_at desc,id desc);
create or replace function reject_research_fundamental_lifecycle_mutation() returns trigger language plpgsql as $$ begin raise exception 'research fundamental lifecycle is append-only'; end $$;
create trigger research_fundamental_lifecycle_append_only before update or delete on research_fundamental_assertion_lifecycle for each row execute function reject_research_fundamental_lifecycle_mutation();
