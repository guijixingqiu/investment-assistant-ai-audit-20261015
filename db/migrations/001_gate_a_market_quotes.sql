create table if not exists stocks (
  id bigserial primary key,
  market text not null,
  code text not null,
  symbol text not null,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (market, code)
);

create table if not exists market_quotes (
  id bigserial primary key,
  stock_id bigint not null references stocks(id),
  market text not null,
  code text not null,
  symbol text not null,
  provider text not null,
  provider_status text not null check (provider_status in ('live', 'stale', 'unavailable')),
  name text,
  currency text not null,
  price numeric(18, 6) not null,
  previous_close numeric(18, 6),
  change_amount numeric(18, 6),
  change_percent numeric(18, 6),
  quote_time timestamptz not null,
  fetched_at timestamptz not null default now(),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists market_quotes_symbol_latest_idx
  on market_quotes (market, code, quote_time desc, fetched_at desc);

create table if not exists data_refresh_runs (
  id bigserial primary key,
  job_id text not null unique,
  job_type text not null,
  idempotency_key text not null,
  status text not null check (status in ('pending', 'running', 'succeeded', 'failed')),
  attempt_count integer not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  last_error text,
  correlation_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists data_refresh_runs_type_status_idx
  on data_refresh_runs (job_type, status, created_at desc);
