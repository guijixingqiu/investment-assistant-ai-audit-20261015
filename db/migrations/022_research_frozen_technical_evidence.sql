alter table research_evidence_packs
  add column if not exists frozen_research_context jsonb;

alter table research_evidence_packs
  add constraint research_evidence_packs_frozen_context_object_check
  check (
    frozen_research_context is null
    or jsonb_typeof(frozen_research_context) = 'object'
  );

create or replace function reject_research_evidence_pack_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'research evidence packs are append-only';
end;
$$;

drop trigger if exists research_evidence_packs_append_only on research_evidence_packs;
create trigger research_evidence_packs_append_only
before update or delete on research_evidence_packs
for each row execute function reject_research_evidence_pack_mutation();
