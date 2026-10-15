alter table research_write_audit_events
  drop constraint if exists research_write_audit_events_event_type_check;

alter table research_write_audit_events
  add constraint research_write_audit_events_event_type_check
  check (event_type in (
    'profile_updated',
    'evidence_created',
    'decision_check_created',
    'post_decision_review_created',
    'research_material_created',
    'research_document_imported',
    'evidence_pack_frozen',
    'deep_research_report_created',
    'deep_research_report_decided',
    'research_event_created',
    'geely_sales_monitor_created',
    'gcl_pv_price_monitor_created'
  ));

alter table research_write_audit_events
  drop constraint if exists research_write_audit_events_candidate_binding_check;

alter table research_write_audit_events
  add constraint research_write_audit_events_candidate_binding_check
  check (
    event_type not in (
      'profile_updated',
      'evidence_created',
      'research_material_created',
      'research_document_imported',
      'evidence_pack_frozen',
      'deep_research_report_created',
      'deep_research_report_decided',
      'research_event_created',
      'geely_sales_monitor_created',
      'gcl_pv_price_monitor_created'
    )
    or (
      request_fingerprint is not null
      and candidate_membership_id is not null
      and candidate_membership_version is not null
      and candidate_membership_version > 0
    )
  ) not valid;

create table if not exists research_documents (
  id bigserial primary key,
  candidate_membership_id bigint not null references candidate_memberships(id) on delete restrict,
  captured_membership_version integer not null check (captured_membership_version > 0),
  title text not null check (length(trim(title)) between 1 and 500),
  original_filename text not null check (length(trim(original_filename)) between 1 and 500),
  published_at timestamptz not null,
  source_version text not null check (length(trim(source_version)) between 1 and 200),
  parser_name text not null check (parser_name = 'pdfjs-dist'),
  parser_version text not null check (parser_version = '6.2.108'),
  normalization_version text not null check (normalization_version = 'nfkc-whitespace-v1'),
  source_classification text not null check (source_classification = 'owner_declared_official'),
  rights_status text not null check (rights_status = 'user_provided'),
  rights_confirmed_at timestamptz not null,
  rights_declaration_version text not null check (rights_declaration_version = 'owner-local-processing-rights-v1'),
  pdf_sha256 text not null check (pdf_sha256 ~ '^[a-f0-9]{64}$'),
  byte_length integer not null check (byte_length > 0),
  page_count integer not null check (page_count > 0),
  imported_at timestamptz not null default now(),
  unique (candidate_membership_id, pdf_sha256)
);

alter table research_documents
  add constraint research_documents_id_membership_unique
  unique (id, candidate_membership_id);

create index if not exists research_documents_membership_imported_idx
  on research_documents (candidate_membership_id, imported_at desc, id desc);

create table if not exists research_document_pages (
  document_id bigint not null references research_documents(id) on delete restrict,
  page_number integer not null check (page_number > 0),
  normalized_text text not null,
  text_sha256 text not null check (text_sha256 ~ '^[a-f0-9]{64}$'),
  primary key (document_id, page_number),
  unique (document_id, page_number, text_sha256)
);

alter table research_materials
  add column if not exists candidate_membership_id bigint references candidate_memberships(id) on delete restrict,
  add column if not exists citation_document_id bigint,
  add column if not exists citation_page_number integer,
  add column if not exists citation_page_text_sha256 text;

alter table research_materials
  add constraint research_materials_citation_all_or_none_check
  check (
    (
      candidate_membership_id is null
      and citation_document_id is null
      and citation_page_number is null
      and citation_page_text_sha256 is null
    )
    or
    (
      candidate_membership_id is not null
      and citation_document_id is not null
      and citation_page_number is not null
      and citation_page_number > 0
      and citation_page_text_sha256 ~ '^[a-f0-9]{64}$'
    )
  );

alter table research_materials
  add constraint research_materials_id_membership_unique
  unique (id, candidate_membership_id);

alter table research_materials
  add constraint research_materials_document_membership_fk
  foreign key (citation_document_id, candidate_membership_id)
  references research_documents (id, candidate_membership_id)
  on delete restrict;

alter table research_materials
  add constraint research_materials_page_citation_fk
  foreign key (citation_document_id, citation_page_number, citation_page_text_sha256)
  references research_document_pages (document_id, page_number, text_sha256)
  on delete restrict;

alter table research_materials
  add constraint research_materials_revision_membership_fk
  foreign key (replaces_material_id, candidate_membership_id)
  references research_materials (id, candidate_membership_id)
  on delete restrict;

do $$
declare
  existing_constraint text;
begin
  select constraint_name
    into existing_constraint
    from information_schema.constraint_column_usage
   where table_schema = current_schema()
     and table_name = 'research_materials'
     and constraint_name in (
       select tc.constraint_name
         from information_schema.table_constraints tc
        where tc.table_schema = current_schema()
          and tc.table_name = 'research_materials'
          and tc.constraint_type = 'UNIQUE'
     )
   group by constraint_name
  having array_agg(column_name::text order by column_name)
       = array['content_fingerprint', 'research_profile_id', 'source_version'];
  if existing_constraint is not null then
    execute format('alter table research_materials drop constraint %I', existing_constraint);
  end if;
end;
$$;

create unique index if not exists research_materials_global_content_version_unique
  on research_materials (research_profile_id, content_fingerprint, source_version)
  where candidate_membership_id is null;

create unique index if not exists research_materials_private_content_version_unique
  on research_materials (candidate_membership_id, content_fingerprint, source_version)
  where candidate_membership_id is not null;

create index if not exists research_materials_membership_created_idx
  on research_materials (candidate_membership_id, created_at asc, id asc)
  where candidate_membership_id is not null;

create or replace function reject_research_document_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'research documents and pages are append-only';
end;
$$;

drop trigger if exists research_documents_append_only on research_documents;
create trigger research_documents_append_only
before update or delete on research_documents
for each row execute function reject_research_document_mutation();

drop trigger if exists research_document_pages_append_only on research_document_pages;
create trigger research_document_pages_append_only
before update or delete on research_document_pages
for each row execute function reject_research_document_mutation();
