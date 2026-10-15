create table if not exists portfolio_positions (
  id bigserial primary key,
  stock_id bigint not null references stocks(id),
  market text not null,
  code text not null,
  symbol text not null,
  legacy_id text,
  quantity numeric(18, 6) not null,
  average_cost numeric(18, 6),
  current_weight numeric(10, 6),
  max_weight numeric(10, 6),
  unrealized_pnl numeric(18, 6),
  status text not null default 'holding',
  snapshot_as_of timestamptz not null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (legacy_id),
  unique (stock_id, snapshot_as_of)
);

create index if not exists portfolio_positions_symbol_status_idx
  on portfolio_positions (market, code, status, snapshot_as_of desc);

create table if not exists pre_trade_decision_checks (
  id bigserial primary key,
  stock_id bigint not null references stocks(id),
  market text not null,
  code text not null,
  symbol text not null,
  legacy_id text,
  action_intent text not null,
  verdict text not null,
  requested_price numeric(18, 6),
  requested_quantity numeric(18, 6),
  current_price numeric(18, 6),
  current_quantity numeric(18, 6),
  average_cost numeric(18, 6),
  market_value numeric(18, 6),
  current_weight numeric(10, 6),
  user_final_decision text,
  decided_at timestamptz,
  checked_at timestamptz not null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (legacy_id)
);

create index if not exists pre_trade_decision_checks_symbol_created_idx
  on pre_trade_decision_checks (market, code, checked_at desc);

create table if not exists migrated_research_events (
  id bigserial primary key,
  stock_id bigint not null references stocks(id),
  market text not null,
  code text not null,
  symbol text not null,
  legacy_id text,
  source_type text not null,
  title text,
  summary text not null,
  event_type text not null,
  impact_direction text not null default 'neutral',
  confidence text not null default 'medium',
  captured_at timestamptz not null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (legacy_id)
);

create index if not exists migrated_research_events_symbol_captured_idx
  on migrated_research_events (market, code, captured_at desc);

create table if not exists legacy_research_events (
  id bigserial primary key,
  legacy_id text not null unique,
  source_type text not null,
  title text,
  summary text not null,
  event_type text not null,
  impact_direction text not null default 'neutral',
  confidence text not null default 'medium',
  captured_at timestamptz not null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists legacy_research_events_captured_idx
  on legacy_research_events (captured_at desc);

create table if not exists data_migration_runs (
  id bigserial primary key,
  run_id text not null unique,
  sample_symbol text not null,
  source_label text not null,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  expected_counts jsonb not null default '{}'::jsonb,
  actual_counts jsonb not null default '{}'::jsonb,
  mismatches jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb
);

create index if not exists data_migration_runs_symbol_started_idx
  on data_migration_runs (sample_symbol, started_at desc);
