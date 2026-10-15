create table assets_alpha_snapshots (
  id bigserial primary key,
  actor_type text not null check (actor_type in ('user', 'system')),
  actor_id text not null check (length(trim(actor_id)) between 1 and 200),
  source text not null check (source in ('manual', 'csv')),
  as_of timestamptz not null,
  cash_hkd numeric check (cash_hkd is null or cash_hkd >= 0),
  positions jsonb not null check (
    jsonb_typeof(positions) = 'array'
    and jsonb_array_length(positions) between 1 and 100
  ),
  owner_confirmed boolean not null check (owner_confirmed = true),
  idempotency_key text not null check (length(trim(idempotency_key)) between 1 and 200),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (actor_type, actor_id, idempotency_key)
);

create table assets_alpha_trades (
  id bigserial primary key,
  actor_type text not null check (actor_type in ('user', 'system')),
  actor_id text not null check (length(trim(actor_id)) between 1 and 200),
  symbol text not null check (symbol ~ '^HK\.[0-9]{5}$'),
  side text not null check (side in ('buy', 'sell')),
  quantity numeric not null check (quantity > 0),
  price_hkd numeric not null check (price_hkd > 0),
  occurred_at timestamptz not null,
  note text check (note is null or length(note) <= 2000),
  owner_confirmed boolean not null check (owner_confirmed = true),
  idempotency_key text not null check (length(trim(idempotency_key)) between 1 and 200),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (actor_type, actor_id, idempotency_key)
);

create or replace function reject_assets_alpha_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Assets Alpha records are append-only';
end;
$$;

create trigger assets_alpha_snapshots_append_only
before update or delete on assets_alpha_snapshots
for each row execute function reject_assets_alpha_mutation();

create trigger assets_alpha_trades_append_only
before update or delete on assets_alpha_trades
for each row execute function reject_assets_alpha_mutation();
