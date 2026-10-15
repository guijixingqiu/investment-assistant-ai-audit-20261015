create table if not exists market_daily_snapshots (
  snapshot_sha text primary key check (snapshot_sha ~ '^[a-f0-9]{64}$'),
  market text not null check (market = 'HK'),
  code text not null check (code ~ '^[0-9]{5}$'),
  symbol text not null check (symbol = 'HK.' || code),
  timeframe text not null check (timeframe = '1d'),
  completed_sessions_only boolean not null check (completed_sessions_only),
  adjustment text not null check (adjustment = 'forward_qfq_research_only'),
  minimum_bars integer not null check (minimum_bars = 80),
  target_bars integer not null check (target_bars = 120),
  cutoff date not null,
  provider text not null check (provider in ('futu_history_kline', 'repository')),
  source_endpoint text not null,
  fetched_at timestamptz not null,
  provider_cutoff date not null check (provider_cutoff <= cutoff),
  data_cutoff_at timestamptz not null,
  last_completed_session date not null check (last_completed_session <= provider_cutoff),
  calendar_id text not null check (calendar_id = 'HKEX'),
  calendar_version text not null,
  calendar_timezone text not null check (calendar_timezone = 'Asia/Hong_Kong'),
  rights_status text not null check (rights_status = 'confirmed'),
  retention_status text not null check (retention_status = 'confirmed'),
  derived_use_status text not null check (derived_use_status = 'confirmed'),
  hash_method text not null check (hash_method = 'sha256_canonical_json_v1'),
  raw_bytes_captured boolean not null check (not raw_bytes_captured),
  source_content_hash text not null check (source_content_hash ~ '^[a-f0-9]{64}$'),
  data_hash text not null check (data_hash ~ '^[a-f0-9]{64}$'),
  page_content_hashes jsonb not null check (jsonb_typeof(page_content_hashes) = 'array'),
  bar_count integer not null check (bar_count >= 80),
  first_session date not null,
  last_session date not null check (last_session <= last_completed_session and first_session <= last_session),
  quality_payload jsonb not null check (jsonb_typeof(quality_payload) = 'object'),
  snapshot_payload jsonb not null check (jsonb_typeof(snapshot_payload) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists market_daily_snapshots_symbol_cutoff_idx
  on market_daily_snapshots (market, code, cutoff desc, created_at desc);

create index if not exists market_daily_snapshots_data_hash_idx
  on market_daily_snapshots (data_hash);

create table if not exists market_daily_bars (
  snapshot_sha text not null references market_daily_snapshots(snapshot_sha) on delete restrict,
  session date not null,
  open numeric not null check (open > 0),
  high numeric not null check (high > 0),
  low numeric not null check (low > 0),
  close numeric not null check (close > 0),
  volume numeric not null check (volume >= 0),
  turnover numeric not null check (turnover >= 0),
  suspension boolean not null,
  primary key (snapshot_sha, session),
  check (low <= open and low <= close and high >= open and high >= close and low <= high)
);

create index if not exists market_daily_bars_snapshot_session_idx
  on market_daily_bars (snapshot_sha, session);

create table if not exists market_technical_snapshots (
  result_hash text primary key check (result_hash ~ '^[a-f0-9]{64}$'),
  input_snapshot_sha text not null references market_daily_snapshots(snapshot_sha) on delete restrict,
  computation_version text not null,
  parameters_payload jsonb not null check (jsonb_typeof(parameters_payload) = 'object'),
  data_cutoff_at timestamptz not null,
  result_payload jsonb not null check (jsonb_typeof(result_payload) = 'object'),
  created_at timestamptz not null default now(),
  unique (input_snapshot_sha, computation_version, result_hash)
);

create table if not exists market_daily_snapshot_states (
  id bigserial primary key,
  market text not null check (market = 'HK'),
  code text not null check (code ~ '^[0-9]{5}$'),
  symbol text not null check (symbol = 'HK.' || code),
  status text not null check (status in ('available', 'incomplete', 'unavailable')),
  snapshot_sha text references market_daily_snapshots(snapshot_sha) on delete restrict,
  result_hash text references market_technical_snapshots(result_hash) on delete restrict,
  message text not null,
  envelope_payload jsonb not null check (jsonb_typeof(envelope_payload) = 'object'),
  updated_at timestamptz not null default now(),
  check (
    (status = 'available' and snapshot_sha is not null and result_hash is not null)
    or (status <> 'available')
  )
);

create index if not exists market_daily_snapshot_states_symbol_updated_idx
  on market_daily_snapshot_states (market, code, updated_at desc, id desc);

create or replace function reject_market_daily_fact_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'market daily and technical facts are append-only';
end;
$$;

drop trigger if exists market_daily_snapshots_append_only on market_daily_snapshots;
create trigger market_daily_snapshots_append_only
before update or delete on market_daily_snapshots
for each row execute function reject_market_daily_fact_mutation();

drop trigger if exists market_daily_bars_append_only on market_daily_bars;
create trigger market_daily_bars_append_only
before update or delete on market_daily_bars
for each row execute function reject_market_daily_fact_mutation();

drop trigger if exists market_technical_snapshots_append_only on market_technical_snapshots;
create trigger market_technical_snapshots_append_only
before update or delete on market_technical_snapshots
for each row execute function reject_market_daily_fact_mutation();

drop trigger if exists market_daily_snapshot_states_append_only on market_daily_snapshot_states;
create trigger market_daily_snapshot_states_append_only
before update or delete on market_daily_snapshot_states
for each row execute function reject_market_daily_fact_mutation();
