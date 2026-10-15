-- One actor-scoped source-lead projection in the existing research database.
create table if not exists research_source_leads (
  lead_id text primary key check (lead_id ~ '^[a-f0-9]{64}$'),
  candidate_membership_id bigint not null references candidate_memberships(id) on delete restrict,
  captured_membership_version integer not null check (captured_membership_version > 0),
  symbol text not null check (symbol ~ '^HK\.[0-9]{5}$'),
  source_type text not null check (source_type in ('issuer_ir','hkex_official','futu_notice','owner_url')),
  publisher text not null check (length(trim(publisher)) between 1 and 200),
  title text not null check (length(trim(title)) between 1 and 500),
  published_at timestamptz not null,
  discovered_at timestamptz not null,
  canonical_url text not null check (canonical_url like 'https://%'),
  document_kind text not null check (document_kind in ('monthly_sales','financial_results','announcement','other')),
  status text not null check (status in ('DISCOVERED','SUPPORTED','IMPORTED','DUPLICATE','REJECTED','NEEDS_REVIEW')),
  origin text not null check (length(origin) between 1 and 200),
  document_id bigint references research_documents(id) on delete restrict,
  document_pdf_sha256 text check (document_pdf_sha256 is null or document_pdf_sha256 ~ '^[a-f0-9]{64}$'),
  review_reason text,
  last_checked_at timestamptz,
  status_changed_at timestamptz not null,
  unique(candidate_membership_id,captured_membership_version,canonical_url,published_at,document_kind)
);
create index if not exists research_source_leads_membership_idx on research_source_leads(candidate_membership_id,captured_membership_version,published_at desc);
alter table research_documents add column if not exists captured_source_url text;
alter table research_documents add column if not exists publisher text;
alter table research_documents add column if not exists document_kind text;
alter table research_documents add column if not exists source_lead_id text references research_source_leads(lead_id) on delete restrict;
alter table research_documents drop constraint if exists research_documents_source_classification_check;
alter table research_documents add constraint research_documents_source_classification_check check (source_classification in ('owner_declared_official','authorized_public_issuer_document'));
alter table research_documents drop constraint if exists research_documents_rights_status_check;
alter table research_documents add constraint research_documents_rights_status_check check (rights_status in ('user_provided','authorized_public'));
alter table research_documents drop constraint if exists research_documents_rights_declaration_version_check;
alter table research_documents add constraint research_documents_rights_declaration_version_check check (rights_declaration_version in ('owner-local-processing-rights-v1','official-public-local-research-v1'));
alter table research_documents add constraint research_documents_capture_provenance_check check (
 (source_classification='owner_declared_official' and rights_status='user_provided' and source_lead_id is null)
 or (source_classification='authorized_public_issuer_document' and rights_status='authorized_public' and captured_source_url like 'https://%' and publisher is not null and document_kind is not null and source_lead_id is not null)
);
