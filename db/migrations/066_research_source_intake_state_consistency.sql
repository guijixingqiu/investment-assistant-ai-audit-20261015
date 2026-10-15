-- Preserve captured versions and review decisions; only extend the current lead projection.
alter table research_source_leads
  add column if not exists provider_category text,
  add column if not exists latest_observed_document_id bigint references research_documents(id) on delete restrict,
  add column if not exists latest_observed_pdf_sha256 text,
  add column if not exists active_trusted_document_id bigint references research_documents(id) on delete restrict,
  add column if not exists active_trusted_pdf_sha256 text,
  add column if not exists pending_review_document_id bigint references research_documents(id) on delete restrict,
  add column if not exists last_fetch_attempt_at timestamptz,
  add column if not exists last_fetch_success_at timestamptz,
  add column if not exists last_fetch_failure_code text,
  add column if not exists consecutive_fetch_failures integer not null default 0,
  add column if not exists next_retry_at timestamptz;
alter table research_source_leads
  add constraint research_source_leads_version_hashes_check check (
    (latest_observed_pdf_sha256 is null or latest_observed_pdf_sha256 ~ '^[a-f0-9]{64}$')
    and (active_trusted_pdf_sha256 is null or active_trusted_pdf_sha256 ~ '^[a-f0-9]{64}$')
  );
with projected as (
  select l.lead_id,l.document_id,l.document_pdf_sha256,
    (select d.id from research_documents d where d.source_lead_id=l.lead_id
      and coalesce((select e.review_state from research_document_review_events e where e.document_id=d.id order by e.event_sequence desc limit 1),d.review_state)='TRUSTED'
      order by d.imported_at desc,d.id desc limit 1) trusted_id,
    (select d.pdf_sha256 from research_documents d where d.source_lead_id=l.lead_id
      and coalesce((select e.review_state from research_document_review_events e where e.document_id=d.id order by e.event_sequence desc limit 1),d.review_state)='TRUSTED'
      order by d.imported_at desc,d.id desc limit 1) trusted_hash,
    (select coalesce((select e.review_state from research_document_review_events e where e.document_id=d.id order by e.event_sequence desc limit 1),d.review_state)
      from research_documents d where d.id=l.document_id and d.source_lead_id=l.lead_id) current_review
  from research_source_leads l
)
update research_source_leads l
set latest_observed_document_id=p.document_id,
    latest_observed_pdf_sha256=p.document_pdf_sha256,
    active_trusted_document_id=p.trusted_id,
    active_trusted_pdf_sha256=p.trusted_hash,
    pending_review_document_id=case when p.current_review='NEEDS_REVIEW' then p.document_id else null end
from projected p where l.lead_id=p.lead_id;

alter table research_source_lead_events
  add column if not exists reason_code text,
  add column if not exists reason_snapshot text;
create index if not exists research_source_lead_events_recent_idx on research_source_lead_events(event_sequence desc);

alter table research_source_refresh_state
  add column if not exists last_discovery_success_at timestamptz,
  add column if not exists discovery_failure_class text;
update research_source_refresh_state set last_discovery_success_at=last_success_at
where last_discovery_success_at is null and last_success_at is not null;
