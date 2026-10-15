alter table research_evidence_packs
  add column if not exists redaction_checksum text;

create or replace function research_evidence_pack_redaction_checksum(pack research_evidence_packs)
returns text
language sql
immutable
as $$
  select md5(concat_ws('|',
    pack.id::text,
    pack.research_profile_id::text,
    pack.candidate_membership_id::text,
    pack.candidate_membership_version::text,
    pack.version::text,
    pack.pack_fingerprint,
    extract(epoch from pack.frozen_at)::text,
    pack.items::text,
    coalesce(pack.frozen_research_context, 'null'::jsonb)::text
  ));
$$;

create or replace function reject_research_evidence_pack_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(old) - array['items', 'redaction_checksum'])
         = (to_jsonb(new) - array['items', 'redaction_checksum'])
     and research_material_array_is_one_way_redaction(old.items, new.items) then
    new.redaction_checksum := research_evidence_pack_redaction_checksum(new);
    return new;
  end if;
  if tg_op = 'UPDATE'
     and (to_jsonb(old) - 'redaction_checksum') = (to_jsonb(new) - 'redaction_checksum')
     and old.redaction_checksum is null
     and new.items @> '[{"sourceType":"deleted"}]'::jsonb
     and new.redaction_checksum = research_evidence_pack_redaction_checksum(new) then return new; end if;
  raise exception 'research evidence packs are append-only except one-way Owner-confirmed material redaction';
end;
$$;

update research_evidence_packs pack
   set redaction_checksum = research_evidence_pack_redaction_checksum(pack)
 where pack.redaction_checksum is null
   and pack.items @> '[{"sourceType":"deleted"}]'::jsonb;

alter table research_evidence_packs
  add constraint research_evidence_packs_redaction_checksum_check
  check (
    (redaction_checksum is null and not items @> '[{"sourceType":"deleted"}]'::jsonb)
    or (redaction_checksum = research_evidence_pack_redaction_checksum(research_evidence_packs)
      and items @> '[{"sourceType":"deleted"}]'::jsonb)
  );

comment on column research_evidence_packs.redaction_checksum is
  'One-way checksum over the exact historical pack row after Owner-confirmed material body redaction.';
