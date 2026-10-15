-- Source intake review is distinct from confirmation of individual facts.
alter table research_documents add column if not exists review_state text not null default 'TRUSTED'
  check (review_state in ('TRUSTED','NEEDS_REVIEW','REJECTED'));
-- Equal bytes from distinct official captures retain separate document provenance.
alter table research_documents drop constraint if exists research_documents_candidate_membership_id_pdf_sha256_key;
create unique index if not exists research_documents_owner_hash_unique on research_documents(candidate_membership_id,pdf_sha256) where source_lead_id is null;
create unique index if not exists research_documents_lead_hash_unique on research_documents(candidate_membership_id,source_lead_id,pdf_sha256) where source_lead_id is not null;
create index if not exists research_documents_lead_versions_idx on research_documents(source_lead_id,imported_at desc,id desc)
  where source_lead_id is not null;
-- The document row is append-only. Review decisions are separate immutable events.
create table if not exists research_document_review_events (
  event_sequence bigserial unique,
  event_id uuid primary key,
  document_id bigint not null references research_documents(id) on delete restrict,
  source_lead_id text not null references research_source_leads(lead_id) on delete restrict,
  review_state text not null check (review_state in ('TRUSTED','NEEDS_REVIEW','REJECTED')),
  reason text not null,
  observed_at timestamptz not null,
  actor_type text not null,
  actor_id text not null
);
create index if not exists research_document_review_events_current_idx on research_document_review_events(document_id,event_sequence desc);
create or replace function reject_research_document_review_mutation() returns trigger language plpgsql as $$ begin raise exception 'research document review is append-only'; end $$;
create trigger research_document_review_append_only before update or delete on research_document_review_events for each row execute function reject_research_document_review_mutation();
insert into research_document_review_events(event_id,document_id,source_lead_id,review_state,reason,observed_at,actor_type,actor_id)
select gen_random_uuid(),d.id,l.lead_id,'NEEDS_REVIEW',coalesce(l.review_reason,'Legacy captured version pending review'),l.status_changed_at,cm.actor_type,cm.actor_id
from research_source_leads l join research_documents d on d.id=l.document_id and d.source_lead_id=l.lead_id
join candidate_memberships cm on cm.id=l.candidate_membership_id
where l.status='NEEDS_REVIEW' and not exists(select 1 from research_document_review_events e where e.document_id=d.id);

alter table research_source_leads add column if not exists publication_date date;
update research_source_leads set publication_date=(published_at at time zone 'UTC')::date where publication_date is null;
alter table research_source_leads alter column publication_date set not null;

create table if not exists research_source_lead_events (
  event_sequence bigserial unique,
  event_id uuid primary key,
  lead_id text not null references research_source_leads(lead_id) on delete restrict,
  from_status text,
  to_status text not null,
  document_id bigint references research_documents(id) on delete restrict,
  pdf_sha256 text,
  reason text,
  observed_at timestamptz not null,
  actor_type text not null,
  actor_id text not null,
  event_type text not null,
  previous_document_id bigint references research_documents(id) on delete restrict,
  previous_pdf_sha256 text
);
create index if not exists research_source_lead_events_lead_idx on research_source_lead_events(lead_id,event_sequence);
create or replace function reject_research_source_event_mutation() returns trigger language plpgsql as $$ begin raise exception 'research source lead events are append-only'; end $$;
create trigger research_source_lead_events_append_only before update or delete on research_source_lead_events for each row execute function reject_research_source_event_mutation();
-- Earlier lead rows had only a mutable projection. Preserve the known state without inventing its transitions.
insert into research_source_lead_events(event_id,lead_id,from_status,to_status,document_id,pdf_sha256,reason,observed_at,actor_type,actor_id,event_type,previous_document_id,previous_pdf_sha256)
select gen_random_uuid(),l.lead_id,null,l.status,l.document_id,l.document_pdf_sha256,'Legacy state snapshot; earlier transitions unknown',l.status_changed_at,cm.actor_type,cm.actor_id,'LEGACY_STATE_SNAPSHOT',null,null
from research_source_leads l join candidate_memberships cm on cm.id=l.candidate_membership_id
where not exists(select 1 from research_source_lead_events e where e.lead_id=l.lead_id);

create table if not exists research_source_refresh_state (
  candidate_membership_id bigint not null references candidate_memberships(id) on delete restrict,
  captured_membership_version integer not null,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_class text,
  consecutive_failures integer not null default 0,
  primary key(candidate_membership_id,captured_membership_version)
);
