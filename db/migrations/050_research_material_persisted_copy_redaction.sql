create or replace function redact_research_material_copies(payload jsonb, material_id text, content_fingerprint text)
returns jsonb
language plpgsql
immutable
as $$
declare
  result jsonb;
  currentness jsonb;
  reasons jsonb;
begin
  if payload is null then return null; end if;
  if jsonb_typeof(payload) = 'array' then
    select coalesce(jsonb_agg(redact_research_material_copies(item, material_id, content_fingerprint) order by ordinal), '[]'::jsonb)
      into result
      from jsonb_array_elements(payload) with ordinality as entries(item, ordinal);
    return result;
  end if;
  if jsonb_typeof(payload) <> 'object' then return payload; end if;
  if payload->>'id' = material_id and payload->>'contentFingerprint' = content_fingerprint
     and payload ? 'contentText' and payload ? 'evidenceId' then
    return payload || jsonb_build_object(
      'title', '[deleted]', 'contentText', '[deleted]', 'sourceType', 'deleted', 'sourceUrl', null,
      'verificationStatus', 'rejected', 'rightsStatus', 'unknown', 'summary', '[deleted]',
      'variableName', null, 'stance', 'neutral', 'reliability', null, 'materiality', null,
      'isRead', true, 'citation', null
    );
  end if;
  select coalesce(jsonb_object_agg(key, redact_research_material_copies(value, material_id, content_fingerprint)), '{}'::jsonb)
    into result from jsonb_each(payload);
  if result is distinct from payload and result ? 'packFingerprint' and result ? 'items' and result ? 'currentness' then
    currentness := result->'currentness';
    reasons := coalesce(currentness->'invalidatedBy', '[]'::jsonb);
    if not reasons @> '["material_set_changed"]'::jsonb then
      reasons := reasons || '["material_set_changed"]'::jsonb;
    end if;
    currentness := jsonb_set(currentness, '{status}', '"historical"'::jsonb, true);
    currentness := jsonb_set(currentness, '{invalidatedBy}', reasons, true);
    result := jsonb_set(result, '{currentness}', currentness, true);
  end if;
  return result;
end;
$$;

create or replace function research_material_array_is_one_way_redaction(old_items jsonb, new_items jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  index integer;
  old_item jsonb;
  new_item jsonb;
  body_fields text[] := array[
    'title', 'contentText', 'sourceType', 'sourceUrl', 'verificationStatus', 'rightsStatus',
    'summary', 'variableName', 'stance', 'reliability', 'materiality', 'isRead', 'citation'
  ];
begin
  if jsonb_typeof(old_items) <> 'array' or jsonb_typeof(new_items) <> 'array'
     or jsonb_array_length(old_items) <> jsonb_array_length(new_items) then return false; end if;
  if jsonb_array_length(old_items) = 0 then return false; end if;
  for index in 0..jsonb_array_length(old_items) - 1 loop
    old_item := old_items->index;
    new_item := new_items->index;
    if old_item = new_item then continue; end if;
    if (old_item - body_fields) is distinct from (new_item - body_fields)
       or new_item->>'title' <> '[deleted]' or new_item->>'contentText' <> '[deleted]'
       or new_item->>'sourceType' <> 'deleted' or new_item->'sourceUrl' is distinct from 'null'::jsonb
       or new_item->>'verificationStatus' <> 'rejected' or new_item->>'rightsStatus' <> 'unknown'
       or new_item->>'summary' <> '[deleted]' or new_item->'variableName' is distinct from 'null'::jsonb
       or new_item->>'stance' <> 'neutral' or new_item->'reliability' is distinct from 'null'::jsonb
       or new_item->'materiality' is distinct from 'null'::jsonb or new_item->'isRead' is distinct from 'true'::jsonb
       or new_item->'citation' is distinct from 'null'::jsonb then return false; end if;
  end loop;
  return true;
end;
$$;

create or replace function deep_research_snapshot_is_material_redaction(old_snapshot jsonb, new_snapshot jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(old_snapshot) = 'object' and jsonb_typeof(new_snapshot) = 'object'
    and (old_snapshot - 'evidencePack') = (new_snapshot - 'evidencePack')
    and jsonb_typeof(old_snapshot->'evidencePack') = 'object'
    and jsonb_typeof(new_snapshot->'evidencePack') = 'object'
    and ((old_snapshot->'evidencePack') - array['items', 'currentness'])
        = ((new_snapshot->'evidencePack') - array['items', 'currentness'])
    and research_material_array_is_one_way_redaction(
      old_snapshot#>'{evidencePack,items}', new_snapshot#>'{evidencePack,items}'
    )
    and new_snapshot#>>'{evidencePack,currentness,status}' = 'historical'
    and new_snapshot#>'{evidencePack,currentness,invalidatedBy}' @> '["material_set_changed"]'::jsonb;
$$;

create or replace function reject_research_evidence_pack_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(old) - 'items') = (to_jsonb(new) - 'items')
     and research_material_array_is_one_way_redaction(old.items, new.items) then return new; end if;
  raise exception 'research evidence packs are append-only except one-way Owner-confirmed material redaction';
end;
$$;

create or replace function reject_deep_research_report_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and old.deleted_at is null and new.deleted_at is not null
     and new.id = old.id and new.research_profile_id = old.research_profile_id
     and new.evidence_pack_id = old.evidence_pack_id and new.version = old.version
     and new.report_contract_version is not distinct from old.report_contract_version
     and new.report_fingerprint is not distinct from old.report_fingerprint
     and new.status = old.status and new.gate_failures = old.gate_failures and new.created_at = old.created_at
     and new.report_payload = '{"state":"deleted"}'::jsonb then return new; end if;
  if tg_op = 'UPDATE' and old.deleted_at is null and new.deleted_at is null
     and (to_jsonb(old) - 'report_payload') = (to_jsonb(new) - 'report_payload')
     and (old.report_payload - 'snapshot') = (new.report_payload - 'snapshot')
     and deep_research_snapshot_is_material_redaction(old.report_payload->'snapshot', new.report_payload->'snapshot')
     then return new; end if;
  raise exception 'deep research reports are append-only except one-way Owner-confirmed body deletion or source redaction';
end;
$$;

alter table deep_research_tasks drop constraint if exists deep_research_tasks_state_check;
alter table deep_research_tasks add constraint deep_research_tasks_state_check check (
  (status = 'pending' and claim_token is null and report_id is null and completed_at is null and lease_expires_at is null)
  or (status = 'running' and claim_token is not null and attempt_count > 0 and report_id is null and completed_at is null and lease_expires_at is not null)
  or (status = 'ready_to_absorb' and claim_token is null and report_id is null and completed_at is not null and lease_expires_at is null and error_code is null)
  or (status = 'succeeded' and claim_token is null and report_id is not null and completed_at is not null and lease_expires_at is null and error_code is null)
  or (status = 'failed' and claim_token is null and report_id is null and completed_at is not null and lease_expires_at is null and error_code is not null)
  or (status = 'canceled' and claim_token is null and report_id is null and completed_at is not null and lease_expires_at is null
      and error_code in ('user_canceled', 'user_rejected', 'report_deleted', 'material_deleted'))
);

do $$
declare
  deleted record;
  affected_pack_ids bigint[];
begin
  for deleted in
    select rm.id::text as material_id, rm.content_fingerprint, rm.candidate_membership_id
      from research_materials rm where rm.deleted_at is not null and rm.candidate_membership_id is not null
  loop
    select coalesce(array_agg(pack.id), '{}'::bigint[]) into affected_pack_ids
      from research_evidence_packs pack
     where pack.candidate_membership_id = deleted.candidate_membership_id
       and pack.items @> jsonb_build_array(jsonb_build_object(
         'id', deleted.material_id, 'contentFingerprint', deleted.content_fingerprint
       ));
    if cardinality(affected_pack_ids) > 0 then
      update deep_research_tasks
         set request_payload = case
               when status in ('pending', 'running', 'ready_to_absorb', 'failed')
                 then redact_research_material_copies(request_payload, deleted.material_id, deleted.content_fingerprint) - 'synthesis' - 'attemptManifest'
               else redact_research_material_copies(request_payload, deleted.material_id, deleted.content_fingerprint)
             end,
             status = case when status in ('pending', 'running', 'ready_to_absorb', 'failed') then 'canceled' else status end,
             report_id = case when status in ('pending', 'running', 'ready_to_absorb', 'failed') then null else report_id end,
             error_code = case when status in ('pending', 'running', 'ready_to_absorb', 'failed') then 'material_deleted' else error_code end,
             claim_token = case when status in ('pending', 'running', 'ready_to_absorb', 'failed') then null else claim_token end,
             lease_expires_at = case when status in ('pending', 'running', 'ready_to_absorb', 'failed') then null else lease_expires_at end,
             completed_at = case when status in ('pending', 'running', 'ready_to_absorb', 'failed') then now() else completed_at end,
             updated_at = now()
       where evidence_pack_id = any(affected_pack_ids);
      update deep_research_reports
         set report_payload = redact_research_material_copies(report_payload, deleted.material_id, deleted.content_fingerprint)
       where evidence_pack_id = any(affected_pack_ids) and deleted_at is null
         and report_payload is distinct from redact_research_material_copies(report_payload, deleted.material_id, deleted.content_fingerprint);
    end if;
    update research_write_audit_events
       set before_payload = redact_research_material_copies(before_payload, deleted.material_id, deleted.content_fingerprint),
           after_payload = redact_research_material_copies(after_payload, deleted.material_id, deleted.content_fingerprint)
     where candidate_membership_id = deleted.candidate_membership_id
       and (before_payload is distinct from redact_research_material_copies(before_payload, deleted.material_id, deleted.content_fingerprint)
         or after_payload is distinct from redact_research_material_copies(after_payload, deleted.material_id, deleted.content_fingerprint));
    update research_evidence_packs
       set items = redact_research_material_copies(items, deleted.material_id, deleted.content_fingerprint)
     where id = any(affected_pack_ids);
  end loop;
end;
$$;

comment on function redact_research_material_copies(jsonb, text, text) is
  'Removes one deleted material body from persisted pack, task, report and audit JSON while retaining exact ids and digests.';
