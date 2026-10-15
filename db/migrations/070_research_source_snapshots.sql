-- Immutable captured HTML originals share the existing external raw-byte CAS.
-- A material cites either an original PDF page or a precise span of this text.
create table if not exists research_source_snapshots (
  id bigserial primary key,
  candidate_membership_id bigint not null references candidate_memberships(id) on delete restrict,
  captured_membership_version integer not null check (captured_membership_version > 0),
  actor_type text not null check (actor_type = 'user'),
  actor_id text not null check (length(actor_id) > 0),
  symbol text not null check (symbol ~ '^HK\.[0-9]{5}$'),
  source_category text not null check (source_category = 'issuer_public_html'),
  canonical_url text not null check (canonical_url like 'https://%'),
  response_url text not null check (response_url like 'https://%'),
  publisher text not null check (length(trim(publisher)) > 0),
  published_at timestamptz,
  captured_at timestamptz not null,
  media_type text not null check (media_type = 'text/html'),
  raw_sha256 text not null check (raw_sha256 ~ '^[a-f0-9]{64}$'),
  byte_length integer not null check (byte_length > 0 and byte_length <= 20971520),
  normalized_text text not null check (length(normalized_text) > 0),
  text_sha256 text not null check (text_sha256 ~ '^[a-f0-9]{64}$'),
  extraction_version text not null check (extraction_version = 'parse5-visible-nfc-v1'),
  summary text not null check (length(summary) between 1 and 4000),
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  unique (actor_type, actor_id, idempotency_key),
  unique (id, candidate_membership_id, captured_membership_version, text_sha256)
);

create or replace function reject_research_source_snapshot_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'research source snapshots are append-only';
end;
$$;
drop trigger if exists research_source_snapshots_append_only on research_source_snapshots;
create trigger research_source_snapshots_append_only
before update or delete on research_source_snapshots
for each row execute function reject_research_source_snapshot_mutation();

alter table research_materials
  add column if not exists citation_snapshot_id bigint,
  add column if not exists citation_snapshot_membership_version integer,
  add column if not exists citation_snapshot_text_sha256 text,
  add column if not exists citation_start_utf16 integer,
  add column if not exists citation_end_utf16 integer,
  add column if not exists citation_excerpt_sha256 text;

alter table research_materials drop constraint if exists research_materials_citation_all_or_none_check;
alter table research_materials add constraint research_materials_citation_all_or_none_check check (
  (citation_document_id is null and citation_page_number is null
    and citation_page_text_sha256 is null and citation_snapshot_id is null and citation_snapshot_membership_version is null
    and citation_snapshot_text_sha256 is null
    and citation_start_utf16 is null and citation_end_utf16 is null and citation_excerpt_sha256 is null)
  or
  (candidate_membership_id is not null and citation_document_id is not null and citation_page_number is not null
    and citation_page_number > 0 and citation_page_text_sha256 is not null
    and citation_page_text_sha256 ~ '^[a-f0-9]{64}$' and citation_snapshot_id is null
    and citation_snapshot_membership_version is null and citation_snapshot_text_sha256 is null
    and citation_start_utf16 is null and citation_end_utf16 is null
    and citation_excerpt_sha256 is null)
  or
  (candidate_membership_id is not null and citation_document_id is null and citation_page_number is null
    and citation_page_text_sha256 is null and citation_snapshot_id is not null
    and citation_snapshot_membership_version is not null and citation_snapshot_membership_version > 0
    and citation_snapshot_text_sha256 is not null and citation_snapshot_text_sha256 ~ '^[a-f0-9]{64}$'
    and citation_start_utf16 is not null and citation_start_utf16 >= 0
    and citation_end_utf16 is not null and citation_end_utf16 > citation_start_utf16
    and citation_excerpt_sha256 is not null and citation_excerpt_sha256 ~ '^[a-f0-9]{64}$')
);

alter table research_materials add constraint research_materials_snapshot_membership_text_fk
foreign key (citation_snapshot_id, candidate_membership_id, citation_snapshot_membership_version, citation_snapshot_text_sha256)
references research_source_snapshots (id, candidate_membership_id, captured_membership_version, text_sha256) on delete restrict;

alter table research_materials drop constraint if exists research_materials_deletion_tombstone_check;
alter table research_materials add constraint research_materials_deletion_tombstone_check check (
  (deleted_at is null and deleted_by_actor_id is null and deletion_membership_version is null)
  or (deleted_at is not null and deleted_by_actor_id is not null
    and length(trim(deleted_by_actor_id)) between 1 and 200
    and deletion_membership_version is not null and deletion_membership_version > 0
    and title='[deleted]' and content_text='[deleted]' and verification_status='rejected'
    and rights_status='unknown' and citation_document_id is null and citation_page_number is null
    and citation_page_text_sha256 is null and citation_snapshot_id is null
    and citation_snapshot_membership_version is null and citation_snapshot_text_sha256 is null
    and citation_start_utf16 is null and citation_end_utf16 is null and citation_excerpt_sha256 is null)
);

alter table research_fundamental_values drop constraint if exists research_fundamental_values_verification_status_check;
alter table research_fundamental_values add constraint research_fundamental_values_verification_status_check check (
  verification_status in ('unverified','verified','owner_confirmed') or
  (verification_status='source_text_verified' and assertion_metadata is not null
    and ((assertion_metadata->'textBinding' is not null and assertion_metadata->'snapshotTextBinding' is null)
      or (assertion_metadata->'textBinding' is null and assertion_metadata->'snapshotTextBinding' is not null)))
);
