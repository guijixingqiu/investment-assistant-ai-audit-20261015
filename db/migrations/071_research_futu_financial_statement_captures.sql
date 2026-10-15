-- Futu quote-provider financial pages are candidate evidence, never issuer originals or formal facts.
create table research_futu_financial_statement_captures (
  id bigserial primary key,
  candidate_membership_id bigint not null references candidate_memberships(id) on delete restrict,
  captured_membership_version integer not null check (captured_membership_version > 0),
  actor_type text not null check (actor_type = 'user'),
  actor_id text not null check (length(actor_id) between 1 and 200),
  symbol text not null check (symbol ~ '^HK\.[0-9]{5}$'),
  source_classification text not null check (source_classification = 'futu_opend_financial_statement_provider'),
  captured_at timestamptz not null,
  page_size integer not null check (page_size between 1 and 20),
  max_pages_per_table integer not null check (max_pages_per_table between 1 and 4),
  table_states jsonb not null check (jsonb_typeof(table_states) = 'object'),
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  unique (actor_type, actor_id, idempotency_key),
  unique (id, candidate_membership_id, captured_membership_version, actor_type, actor_id)
);
create index research_futu_financial_capture_member_idx
  on research_futu_financial_statement_captures (candidate_membership_id, captured_at desc, id desc);

create table research_futu_financial_statement_pages (
  id bigserial primary key,
  capture_id bigint not null,
  candidate_membership_id bigint not null,
  captured_membership_version integer not null,
  actor_type text not null,
  actor_id text not null,
  statement_type text not null check (statement_type in ('income', 'balance_sheet', 'cash_flow')),
  page_number integer not null check (page_number between 1 and 4),
  requested_cursor text,
  next_cursor text not null check (length(next_cursor) between 1 and 100),
  captured_at timestamptz not null,
  raw_sha256 text not null check (raw_sha256 ~ '^[a-f0-9]{64}$'),
  byte_length integer not null check (byte_length between 1 and 1048576),
  report_summaries jsonb not null check (jsonb_typeof(report_summaries) = 'array'),
  foreign key (capture_id, candidate_membership_id, captured_membership_version, actor_type, actor_id)
    references research_futu_financial_statement_captures
      (id, candidate_membership_id, captured_membership_version, actor_type, actor_id) on delete restrict,
  unique (capture_id, statement_type, page_number)
);

create or replace function reject_research_futu_financial_capture_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Futu financial statement captures are append-only';
end;
$$;
create trigger research_futu_financial_captures_append_only
before update or delete on research_futu_financial_statement_captures
for each row execute function reject_research_futu_financial_capture_mutation();
create trigger research_futu_financial_pages_append_only
before update or delete on research_futu_financial_statement_pages
for each row execute function reject_research_futu_financial_capture_mutation();
