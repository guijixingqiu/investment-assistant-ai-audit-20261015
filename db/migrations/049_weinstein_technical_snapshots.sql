create table if not exists weinstein_technical_snapshots (
  id bigserial primary key,
  symbol text not null check (symbol ~ '^HK\.[0-9]{5}$'),
  analysis_as_of date not null,
  completed_week_end date not null check (completed_week_end <= analysis_as_of),
  result_hash text not null unique check (result_hash ~ '^[a-f0-9]{64}$'),
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  dataset_hash text not null check (dataset_hash ~ '^[a-f0-9]{64}$'),
  envelope_payload jsonb not null check (jsonb_typeof(envelope_payload) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists weinstein_technical_snapshots_symbol_created_idx
  on weinstein_technical_snapshots (symbol, analysis_as_of desc, id desc);

drop trigger if exists weinstein_technical_snapshots_append_only on weinstein_technical_snapshots;
create trigger weinstein_technical_snapshots_append_only
before update or delete on weinstein_technical_snapshots
for each row execute function reject_market_daily_fact_mutation();
