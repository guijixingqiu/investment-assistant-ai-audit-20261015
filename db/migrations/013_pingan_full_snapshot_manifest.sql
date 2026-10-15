create table if not exists pingan_import_batch_manifests (
  batch_id text primary key,
  manifest_sequence bigint generated always as identity unique,
  account_scope_id text not null,
  manifest_version text not null,
  is_full_snapshot boolean not null,
  expected_position_count integer not null check (expected_position_count >= 0),
  expected_symbols text[] not null,
  expected_symbols_sha256 text not null,
  expected_position_facts_sha256 text not null,
  expected_batch_imported_at timestamptz not null,
  snapshot_group_id text not null,
  source_as_of timestamptz not null,
  source_fetched_at timestamptz not null,
  position_snapshot_ids text[] not null,
  created_at timestamptz not null default now(),
  check (cardinality(expected_symbols) = expected_position_count),
  check (cardinality(position_snapshot_ids) = expected_position_count),
  check (manifest_sequence > 0),
  check (expected_symbols_sha256 ~ '^[0-9a-f]{64}$'),
  check (expected_position_facts_sha256 ~ '^[0-9a-f]{64}$'),
  check (nullif(snapshot_group_id, '') is not null),
  check (nullif(account_scope_id, '') is not null),
  check (source_as_of <= source_fetched_at),
  check (source_fetched_at <= created_at),
  check (expected_batch_imported_at <= created_at)
);

comment on table pingan_import_batch_manifests is
  'Fail-closed source-side declaration for one complete Pingan account snapshot. Rows bind a database-generated immutable append sequence, import batch and clocks, source-fetch clock, account, canonical symbol set, exact position snapshot IDs, normalized source-fact SHA-256, and source time; absence or clock regression never falls back to an older batch.';

create or replace function reject_pingan_import_batch_manifest_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Pingan full-snapshot manifests are immutable; append a new import batch instead'
    using errcode = '55000';
end;
$$;

drop trigger if exists pingan_import_batch_manifests_immutable
  on pingan_import_batch_manifests;
create trigger pingan_import_batch_manifests_immutable
before update or delete on pingan_import_batch_manifests
for each row execute function reject_pingan_import_batch_manifest_mutation();

drop trigger if exists pingan_import_batch_manifests_truncate_immutable
  on pingan_import_batch_manifests;
create trigger pingan_import_batch_manifests_truncate_immutable
before truncate on pingan_import_batch_manifests
for each statement execute function reject_pingan_import_batch_manifest_mutation();

create or replace function pingan_import_batch_position_facts_sha256(
  requested_batch_id text,
  requested_account_scope_id text,
  requested_position_snapshot_ids text[]
)
returns text
language plpgsql
stable
as $$
declare
  facts_sha256 text;
begin
  if to_regclass('broker_import_batches') is null
    or to_regclass('broker_raw_transactions') is null
    or to_regclass('broker_trades') is null
    or to_regclass('positions') is null
    or to_regclass('position_snapshots') is null then
    return null;
  end if;

  execute $query$
    with fact_rows as (
      select b.id::text as batch_id,
             b.status::text as batch_status,
             b.source::text as batch_source,
             case when b.created_at is null then null else
               to_char(b.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
             end as batch_imported_at,
             b.account_ref::text as batch_account_scope_id,
             rt.id::text as raw_transaction_id,
             rt.quantity::text as raw_quantity,
             bt.id::text as trade_id,
             bt.position_id::text as trade_position_id,
             p.id::text as position_id,
             p.market::text as market,
             p.code::text as code,
             p.symbol::text as symbol,
             p.name::text as name,
             p.account_ref::text as position_account_scope_id,
             p.currency::text as currency,
             p.status::text as position_status,
             ps.id::text as position_snapshot_id,
             ps.quantity::text as snapshot_quantity,
             ps.average_cost::text as average_cost,
             ps.current_weight::text as current_weight,
             ps.max_weight::text as max_weight,
             ps.unrealized_pnl::text as unrealized_pnl,
             case when ps.snapshot_as_of is null then null else
               to_char(ps.snapshot_as_of at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
             end as snapshot_as_of,
             case when ps.created_at is null then null else
               to_char(ps.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
             end as snapshot_created_at
        from broker_import_batches b
        left join broker_raw_transactions rt on rt.batch_id = b.id
        left join broker_trades bt on bt.raw_transaction_id = rt.id
        left join positions p on p.id = bt.position_id
        left join position_snapshots ps
          on ps.position_id = p.id
         and ps.id::text = any(coalesce($3::text[], array[]::text[]))
       where b.id::text = $1
         and b.account_ref::text = $2
    )
    select encode(
             sha256(
               convert_to(
                 coalesce(
                   jsonb_agg(
                     jsonb_build_object(
                       'batchId', facts.batch_id,
                       'batchStatus', facts.batch_status,
                       'batchSource', facts.batch_source,
                       'batchImportedAt', facts.batch_imported_at,
                       'batchAccountScopeId', facts.batch_account_scope_id,
                       'rawTransactionId', facts.raw_transaction_id,
                       'rawQuantity', facts.raw_quantity,
                       'tradeId', facts.trade_id,
                       'tradePositionId', facts.trade_position_id,
                       'positionId', facts.position_id,
                       'market', facts.market,
                       'code', facts.code,
                       'symbol', facts.symbol,
                       'name', facts.name,
                       'positionAccountScopeId', facts.position_account_scope_id,
                       'currency', facts.currency,
                       'positionStatus', facts.position_status,
                       'positionSnapshotId', facts.position_snapshot_id,
                       'snapshotQuantity', facts.snapshot_quantity,
                       'averageCost', facts.average_cost,
                       'currentWeight', facts.current_weight,
                       'maxWeight', facts.max_weight,
                       'unrealizedPnl', facts.unrealized_pnl,
                       'snapshotAsOf', facts.snapshot_as_of,
                       'snapshotCreatedAt', facts.snapshot_created_at
                     )
                     order by facts.raw_transaction_id, facts.trade_id,
                              facts.position_id, facts.position_snapshot_id
                   ),
                   '[]'::jsonb
                 )::text,
                 'UTF8'
               )
             ),
             'hex'
           )
      from fact_rows facts
  $query$ into facts_sha256 using requested_batch_id, requested_account_scope_id,
    requested_position_snapshot_ids;

  return facts_sha256;
end;
$$;

create or replace function pingan_imported_snapshot_source_ready()
returns boolean
language sql
stable
as $$
  select to_regclass('broker_import_batches') is not null
     and to_regclass('broker_raw_transactions') is not null
     and to_regclass('broker_trades') is not null
     and to_regclass('positions') is not null
     and to_regclass('position_snapshots') is not null
     and to_regclass('pingan_import_batch_manifests') is not null
     and not exists (
       select 1
         from (values
           ('broker_import_batches', 'id'),
           ('broker_import_batches', 'status'),
           ('broker_import_batches', 'source'),
           ('broker_import_batches', 'created_at'),
           ('broker_import_batches', 'account_ref'),
           ('broker_raw_transactions', 'id'),
           ('broker_raw_transactions', 'batch_id'),
           ('broker_raw_transactions', 'quantity'),
           ('broker_trades', 'id'),
           ('broker_trades', 'raw_transaction_id'),
           ('broker_trades', 'position_id'),
           ('positions', 'id'),
           ('positions', 'market'),
           ('positions', 'code'),
           ('positions', 'symbol'),
           ('positions', 'name'),
           ('positions', 'account_ref'),
           ('positions', 'currency'),
           ('positions', 'status'),
           ('position_snapshots', 'id'),
           ('position_snapshots', 'position_id'),
           ('position_snapshots', 'quantity'),
           ('position_snapshots', 'average_cost'),
           ('position_snapshots', 'current_weight'),
           ('position_snapshots', 'max_weight'),
           ('position_snapshots', 'unrealized_pnl'),
           ('position_snapshots', 'snapshot_as_of'),
           ('position_snapshots', 'created_at'),
           ('pingan_import_batch_manifests', 'batch_id'),
           ('pingan_import_batch_manifests', 'manifest_sequence'),
           ('pingan_import_batch_manifests', 'account_scope_id'),
           ('pingan_import_batch_manifests', 'manifest_version'),
           ('pingan_import_batch_manifests', 'is_full_snapshot'),
           ('pingan_import_batch_manifests', 'expected_position_count'),
           ('pingan_import_batch_manifests', 'expected_symbols'),
           ('pingan_import_batch_manifests', 'expected_symbols_sha256'),
           ('pingan_import_batch_manifests', 'expected_position_facts_sha256'),
           ('pingan_import_batch_manifests', 'expected_batch_imported_at'),
           ('pingan_import_batch_manifests', 'snapshot_group_id'),
           ('pingan_import_batch_manifests', 'source_as_of'),
           ('pingan_import_batch_manifests', 'source_fetched_at'),
           ('pingan_import_batch_manifests', 'position_snapshot_ids'),
           ('pingan_import_batch_manifests', 'created_at')
         ) as required(table_name, column_name)
        where not exists (
          select 1
            from information_schema.columns c
           where c.table_schema = current_schema()
             and c.table_name = required.table_name
             and c.column_name = required.column_name
        )
     );
$$;

create or replace function pingan_imported_snapshot_batch_validation_rows()
returns table (
  market text,
  code text,
  account_scope_id text,
  batch_id text,
  source_as_of timestamptz,
  imported_at timestamptz,
  fetched_at timestamptz,
  snapshot_group_id text,
  conflict_reason text,
  conflicting_row_count bigint
)
language plpgsql
stable
as $$
begin
  if not pingan_imported_snapshot_source_ready() then
    return;
  end if;

  return query execute $query$
    with candidate_keys as (
      select b.id::text as batch_id,
             b.account_ref::text as account_scope_id
        from broker_import_batches b
       where lower(b.source::text) in ('pingan', 'pingan_imported_snapshot')
      union
      select manifest.batch_id,
             manifest.account_scope_id
        from pingan_import_batch_manifests manifest
    ),
    candidate_batches as (
      select keys.batch_id,
             keys.account_scope_id,
             b.created_at as imported_at,
             b.status::text as batch_status,
             b.source::text as batch_source,
             b.account_ref::text as batch_account_scope_id,
             coalesce(b.created_at, manifest.expected_batch_imported_at) as candidate_at
        from candidate_keys keys
        left join broker_import_batches b on b.id::text = keys.batch_id
        left join pingan_import_batch_manifests manifest
          on manifest.batch_id = keys.batch_id
         and manifest.account_scope_id = keys.account_scope_id
       where nullif(keys.account_scope_id, '') is not null
         and keys.account_scope_id !~* '(sample|fixture|migrated|shadow|quant|research|unknown-stale)'
    ),
    ranked_batches as (
      select candidate_batches.*,
             row_number() over (
               partition by account_scope_id
               order by candidate_at desc, batch_id desc
             ) as import_rank,
             count(*) over (
               partition by account_scope_id, candidate_at
             ) as same_time_count
        from candidate_batches
    ),
    selected_batches as (
      select *
        from ranked_batches
       where import_rank = 1
    ),
    account_holding_rows as (
      select sb.batch_id,
             sb.account_scope_id,
             p.id as position_id,
             upper(nullif(p.market::text, '')) as market,
             upper(nullif(p.code::text, '')) as code,
             coalesce(
               nullif(upper(p.symbol::text), ''),
               upper(nullif(p.market::text, '')) || '.' || upper(nullif(p.code::text, ''))
             ) as symbol
        from selected_batches sb
        left join positions p
          on p.account_ref::text = sb.account_scope_id
         and p.status::text = 'holding'
    ),
    account_holding_stats as (
      select rows.batch_id,
             rows.account_scope_id,
             count(rows.position_id) as account_holding_count,
             count(distinct rows.symbol) filter (where rows.position_id is not null)
               as distinct_account_symbol_count,
             coalesce(
               array_agg(rows.symbol order by rows.symbol)
                 filter (where rows.position_id is not null),
               array[]::text[]
             ) as account_holding_symbols,
             coalesce(
               bool_and(coalesce(
                 rows.market = 'HK'
                 and rows.code ~ '^[0-9]{5}$'
                 and rows.symbol = 'HK.' || rows.code
               , false)) filter (where rows.position_id is not null),
               true
             ) as account_holding_identity_valid
        from account_holding_rows rows
       group by rows.batch_id, rows.account_scope_id
    ),
    batch_activity_stats as (
      select sb.batch_id,
             sb.account_scope_id,
             count(distinct rt.id) as raw_transaction_count,
             count(distinct bt.id) as trade_count,
             count(*) filter (where rt.id is not null) as raw_trade_join_count
        from selected_batches sb
        left join broker_import_batches b on b.id::text = sb.batch_id
        left join broker_raw_transactions rt on rt.batch_id = b.id
        left join broker_trades bt on bt.raw_transaction_id = rt.id
       group by sb.batch_id, sb.account_scope_id
    ),
    transaction_positions as (
      select sb.batch_id,
             sb.account_scope_id,
             sb.imported_at,
             sb.same_time_count,
             p.id as position_id,
             p.account_ref::text as position_account_scope_id,
             upper(nullif(p.market::text, '')) as market,
             upper(nullif(p.code::text, '')) as code,
             coalesce(
               nullif(upper(p.symbol::text), ''),
               upper(nullif(p.market::text, '')) || '.' || upper(nullif(p.code::text, ''))
             ) as symbol,
             p.currency::text as currency,
             p.status::text as position_status,
             sum(
               case
                 when rt.quantity::text ~ '^-?[0-9]+(\.[0-9]+)?$' then rt.quantity::numeric
                 else null
               end
             ) as reconciled_transaction_quantity,
             bool_or(rt.quantity is null or rt.quantity::text !~ '^-?[0-9]+(\.[0-9]+)?$') as malformed_transaction_quantity,
             count(distinct bt.id) as trade_count
        from selected_batches sb
        left join broker_import_batches b on b.id::text = sb.batch_id
        left join broker_raw_transactions rt on rt.batch_id = b.id
        left join broker_trades bt on bt.raw_transaction_id = rt.id
        left join positions p on p.id = bt.position_id
       group by sb.batch_id, sb.account_scope_id, sb.imported_at, sb.same_time_count,
                p.id, p.account_ref, p.market, p.code, p.symbol, p.currency, p.status
    ),
    position_facts as (
      select tp.*,
             count(ps.id) as bound_snapshot_count,
             min(ps.id::text) as snapshot_id,
             min(ps.snapshot_as_of) as snapshot_as_of,
             min(ps.created_at) as snapshot_created_at,
             min(ps.quantity) as snapshot_quantity,
             min(ps.average_cost) as average_cost,
             min(ps.current_weight) as current_weight,
             min(ps.max_weight) as max_weight,
             min(ps.unrealized_pnl) as unrealized_pnl
        from transaction_positions tp
        left join pingan_import_batch_manifests m
          on m.batch_id = tp.batch_id
         and m.account_scope_id = tp.account_scope_id
        left join position_snapshots ps
          on ps.position_id = tp.position_id
         and ps.id::text = any(coalesce(m.position_snapshot_ids, array[]::text[]))
       group by tp.batch_id, tp.account_scope_id, tp.imported_at, tp.same_time_count,
                tp.position_id, tp.position_account_scope_id, tp.market, tp.code,
                tp.symbol, tp.currency, tp.position_status, tp.reconciled_transaction_quantity,
                tp.malformed_transaction_quantity, tp.trade_count
    ),
    batch_stats as (
      select sb.batch_id,
             sb.account_scope_id,
             sb.imported_at,
             sb.same_time_count,
             sb.batch_status,
             sb.batch_source,
             sb.batch_account_scope_id,
             m.batch_id as manifest_batch_id,
             m.manifest_sequence,
             m.account_scope_id as manifest_account_scope_id,
             m.manifest_version,
             m.is_full_snapshot,
             m.expected_position_count,
             m.expected_symbols,
             m.expected_symbols_sha256,
             m.expected_position_facts_sha256,
             m.expected_batch_imported_at,
             m.snapshot_group_id,
             m.source_as_of,
             m.source_fetched_at,
             m.position_snapshot_ids,
             m.created_at as manifest_created_at,
             count(pf.position_id) filter (where pf.position_id is not null) as actual_position_count,
             array_agg(pf.symbol order by pf.symbol) filter (where pf.position_id is not null) as actual_symbols,
             min(pf.market) filter (where pf.position_id is not null) as first_market,
             min(pf.code) filter (where pf.position_id is not null) as first_code,
             coalesce(bool_and(coalesce(
               pf.position_id is not null
               and pf.position_account_scope_id = sb.account_scope_id
               and pf.position_status = 'holding'
             , false)), false) as account_and_status_match,
             coalesce(bool_and(coalesce(
               pf.position_id is not null
               and pf.bound_snapshot_count = 1
               and pf.snapshot_as_of = m.source_as_of
               and pf.snapshot_created_at = m.source_fetched_at
             , false)), false) as snapshot_binding_matches,
             coalesce(bool_and(coalesce(
               pf.position_id is not null
               and pf.trade_count > 0
               and pf.malformed_transaction_quantity = false
               and pf.reconciled_transaction_quantity::text ~ '^-?[0-9]+(\.[0-9]+)?$'
               and pf.reconciled_transaction_quantity > 0
               and pf.reconciled_transaction_quantity = pf.snapshot_quantity
             , false)), false) as quantities_reconcile,
             coalesce(bool_and(coalesce(
               pf.position_id is not null
               and pf.currency = 'HKD'
               and pf.snapshot_quantity::text ~ '^-?[0-9]+(\.[0-9]+)?$'
               and pf.snapshot_quantity > 0
               and (
                 pf.average_cost is null
                 or pf.average_cost::text ~ '^-?[0-9]+(\.[0-9]+)?$'
                    and pf.average_cost >= 0
               )
               and (
                 pf.current_weight is null
                 or pf.current_weight::text ~ '^-?[0-9]+(\.[0-9]+)?$'
                    and pf.current_weight between 0 and 1
               )
               and (
                 pf.max_weight is null
                 or pf.max_weight::text ~ '^-?[0-9]+(\.[0-9]+)?$'
                    and pf.max_weight between 0 and 1
               )
               and (
                 pf.unrealized_pnl is null
                 or pf.unrealized_pnl::text ~ '^-?[0-9]+(\.[0-9]+)?$'
               )
             , false)), false) as position_values_valid,
             coalesce(sum(pf.bound_snapshot_count), 0)::bigint as bound_snapshot_count,
             count(distinct pf.snapshot_created_at)
               filter (where pf.position_id is not null) as snapshot_fetch_time_count,
             holdings.account_holding_count,
             holdings.distinct_account_symbol_count,
             holdings.account_holding_symbols,
             holdings.account_holding_identity_valid,
             activity.raw_transaction_count,
             activity.trade_count as batch_trade_count,
             activity.raw_trade_join_count,
             activity.raw_transaction_count = activity.trade_count
               and activity.raw_transaction_count = activity.raw_trade_join_count
               as raw_trade_topology_matches
        from selected_batches sb
        left join pingan_import_batch_manifests m
          on m.batch_id = sb.batch_id
         and m.account_scope_id = sb.account_scope_id
        left join position_facts pf
          on pf.batch_id = sb.batch_id
         and pf.account_scope_id = sb.account_scope_id
        join account_holding_stats holdings
          on holdings.batch_id = sb.batch_id
         and holdings.account_scope_id = sb.account_scope_id
        join batch_activity_stats activity
          on activity.batch_id = sb.batch_id
         and activity.account_scope_id = sb.account_scope_id
       group by sb.batch_id, sb.account_scope_id, sb.imported_at, sb.same_time_count,
                sb.batch_status, sb.batch_source, sb.batch_account_scope_id,
                m.batch_id, m.manifest_sequence, m.account_scope_id, m.manifest_version, m.is_full_snapshot,
                m.expected_position_count, m.expected_symbols, m.expected_symbols_sha256,
                m.expected_position_facts_sha256, m.expected_batch_imported_at,
                m.snapshot_group_id, m.source_as_of, m.source_fetched_at,
                m.position_snapshot_ids, m.created_at, holdings.account_holding_count,
                holdings.distinct_account_symbol_count, holdings.account_holding_symbols,
                holdings.account_holding_identity_valid, activity.raw_transaction_count,
                activity.trade_count, activity.raw_trade_join_count
    ),
    hashed_stats as (
      select stats.*,
             pingan_import_batch_position_facts_sha256(
               stats.batch_id,
               stats.account_scope_id,
               stats.position_snapshot_ids
             ) as actual_position_facts_sha256
        from batch_stats stats
    )
    select case when stats.actual_position_count = 1 then stats.first_market else null end as market,
           case when stats.actual_position_count = 1 then stats.first_code else null end as code,
           stats.account_scope_id,
           stats.batch_id,
           coalesce(stats.source_as_of, stats.imported_at) as source_as_of,
           stats.imported_at,
           stats.source_fetched_at as fetched_at,
           stats.snapshot_group_id,
           case
             when exists (
               select 1
                 from pingan_import_batch_manifests candidate_manifest
                 left join broker_import_batches candidate_batch
                   on candidate_batch.id::text = candidate_manifest.batch_id
                where candidate_batch.id is null
                  and candidate_manifest.account_scope_id = stats.account_scope_id
             ) then 'orphan_batch_manifest'
             when exists (
               select 1
                 from pingan_import_batch_manifests candidate_manifest
                 join broker_import_batches candidate_batch
                   on candidate_batch.id::text = candidate_manifest.batch_id
                where (
                    candidate_manifest.account_scope_id = stats.account_scope_id
                    or candidate_batch.account_ref::text = stats.account_scope_id
                  )
                  and (
                    candidate_batch.account_ref::text is distinct from candidate_manifest.account_scope_id
                    or candidate_batch.created_at is distinct from candidate_manifest.expected_batch_imported_at
                  )
             ) then 'batch_source_conflict'
             when exists (
               select 1
                 from pingan_import_batch_manifests newer_manifest
                 join broker_import_batches newer_batch
                   on newer_batch.id::text = newer_manifest.batch_id
                 join pingan_import_batch_manifests older_manifest
                   on older_manifest.batch_id <> newer_manifest.batch_id
                 join broker_import_batches older_batch
                   on older_batch.id::text = older_manifest.batch_id
                  and older_batch.account_ref::text = newer_batch.account_ref::text
                where newer_batch.account_ref::text = stats.account_scope_id
                  and newer_manifest.manifest_sequence > older_manifest.manifest_sequence
                  and newer_manifest.expected_batch_imported_at < older_manifest.expected_batch_imported_at
             ) then 'batch_source_conflict'
             when stats.same_time_count <> 1 then 'ambiguous_latest_batch'
             when stats.imported_at is null
               or stats.batch_status is null
               or stats.batch_status not in ('approved', 'succeeded', 'imported')
               or stats.batch_source is null
               or lower(stats.batch_source) not in ('pingan', 'pingan_imported_snapshot')
               or stats.batch_account_scope_id is distinct from stats.account_scope_id
               then 'batch_source_conflict'
             when stats.manifest_batch_id is null
               or stats.manifest_sequence is null
               or stats.manifest_sequence <= 0
               or stats.manifest_account_scope_id <> stats.account_scope_id
               or stats.manifest_version is distinct from '2026-07-19.pingan-full-account-snapshot.v1'
               or stats.is_full_snapshot is distinct from true
               or stats.expected_position_count is null
               or stats.expected_position_count < 0
               or cardinality(stats.expected_symbols) <> stats.expected_position_count
               or stats.position_snapshot_ids is null
               or cardinality(stats.position_snapshot_ids) <> stats.expected_position_count
               or cardinality(stats.position_snapshot_ids) <>
                    cardinality(array(select distinct value from unnest(stats.position_snapshot_ids) value))
               or stats.expected_symbols is distinct from
                    array(
                      select distinct upper(value)
                        from unnest(stats.expected_symbols) value
                       where upper(value) ~ '^HK\.[0-9]{5}$'
                       order by upper(value)
                    )
               or stats.expected_symbols_sha256 is distinct from encode(
                    sha256(convert_to(array_to_string(stats.expected_symbols, E'\n'), 'UTF8')),
                    'hex'
                  )
               or stats.expected_position_facts_sha256 is null
               or stats.expected_position_facts_sha256 !~ '^[0-9a-f]{64}$'
               or stats.expected_batch_imported_at is null
               or nullif(stats.snapshot_group_id, '') is null
               or stats.source_as_of is null
               or stats.source_fetched_at is null
               or stats.manifest_created_at is null
               or stats.source_as_of > stats.source_fetched_at
               or stats.source_fetched_at > stats.manifest_created_at
               or stats.expected_batch_imported_at > stats.manifest_created_at
               then 'incomplete_batch_manifest'
             when stats.imported_at is distinct from stats.expected_batch_imported_at
               then 'batch_source_conflict'
             when stats.expected_position_count = 0
               and (
                 stats.actual_position_count <> 0
                 or stats.bound_snapshot_count <> 0
                 or exists (
                   select 1
                     from broker_import_batches activity_batch
                     join broker_raw_transactions activity_raw
                       on activity_raw.batch_id = activity_batch.id
                    where activity_batch.id::text = stats.batch_id
                 )
               )
               then 'manifest_position_count_mismatch'
             when stats.actual_position_facts_sha256 is distinct from stats.expected_position_facts_sha256
               then 'snapshot_facts_hash_mismatch'
             when stats.expected_position_count = 0
               and (
                 stats.account_holding_identity_valid is distinct from true
                 or stats.account_holding_count <> 0
                 or stats.distinct_account_symbol_count <> stats.account_holding_count
                 or stats.account_holding_symbols is distinct from stats.expected_symbols
               )
               then 'incomplete_account_snapshot'
             when stats.expected_position_count = 0 then null
             when stats.account_and_status_match is distinct from true then 'cross_account_or_nonholding_position'
             when stats.actual_position_count <> stats.expected_position_count then 'manifest_position_count_mismatch'
             when stats.actual_symbols is distinct from stats.expected_symbols then 'manifest_symbol_set_mismatch'
             when stats.bound_snapshot_count <> stats.expected_position_count
               or stats.snapshot_fetch_time_count <> 1
               or stats.snapshot_binding_matches is distinct from true
               then 'snapshot_batch_binding_mismatch'
             when stats.position_values_valid is distinct from true
               then 'malformed_position_facts'
             when stats.raw_trade_topology_matches is distinct from true
               then 'raw_trade_topology_mismatch'
             when stats.quantities_reconcile is distinct from true then 'quantity_mismatch'
             when stats.account_holding_identity_valid is distinct from true
               or stats.account_holding_count <> stats.expected_position_count
               or stats.distinct_account_symbol_count <> stats.account_holding_count
               or stats.account_holding_symbols is distinct from stats.expected_symbols
               then 'incomplete_account_snapshot'
             else null
           end as conflict_reason,
           greatest(stats.same_time_count, stats.actual_position_count, stats.bound_snapshot_count)::bigint
             as conflicting_row_count
      from hashed_stats stats
  $query$;
end;
$$;

create or replace function pingan_imported_snapshot_position_rows()
returns table (
  market text,
  code text,
  symbol text,
  name text,
  quantity numeric,
  average_cost numeric,
  current_weight numeric,
  max_weight numeric,
  unrealized_pnl numeric,
  status text,
  source_as_of timestamptz,
  imported_at timestamptz,
  fetched_at timestamptz,
  account_scope_id text,
  source_system text,
  source_class text,
  source_label text,
  currency text,
  source_row_id text,
  updated_at timestamptz
)
language plpgsql
stable
as $$
begin
  if not pingan_imported_snapshot_source_ready() then
    return;
  end if;

  return query execute $query$
    with valid_batches as (
      select validation.*
        from pingan_imported_snapshot_batch_validation_rows() validation
       where validation.conflict_reason is null
    ),
    reconciled_positions as (
      select vb.batch_id,
             vb.account_scope_id,
             vb.imported_at,
             m.source_as_of,
             p.id as position_id,
             upper(p.market::text) as market,
             upper(p.code::text) as code,
             coalesce(nullif(upper(p.symbol::text), ''), upper(p.market::text) || '.' || upper(p.code::text)) as symbol,
             nullif(p.name::text, '') as name,
             nullif(p.currency::text, '') as currency,
             ps.id::text as snapshot_id,
             ps.quantity::numeric as quantity,
             ps.average_cost::numeric as average_cost,
             ps.current_weight::numeric as current_weight,
             ps.max_weight::numeric as max_weight,
             ps.unrealized_pnl::numeric as unrealized_pnl,
             ps.snapshot_as_of,
             ps.created_at as snapshot_created_at,
             count(distinct bt.id) as trade_count,
             sum(rt.quantity::numeric) as reconciled_transaction_quantity
        from valid_batches vb
        join pingan_import_batch_manifests m
          on m.batch_id = vb.batch_id
         and m.account_scope_id = vb.account_scope_id
        join broker_import_batches b on b.id::text = vb.batch_id
        join broker_raw_transactions rt on rt.batch_id = b.id
        join broker_trades bt on bt.raw_transaction_id = rt.id
        join positions p on p.id = bt.position_id
                        and p.account_ref::text = vb.account_scope_id
                        and p.status::text = 'holding'
        join position_snapshots ps on ps.position_id = p.id
                                  and ps.id::text = any(m.position_snapshot_ids)
                                  and ps.snapshot_as_of = m.source_as_of
       group by vb.batch_id, vb.account_scope_id, vb.imported_at, m.source_as_of,
                p.id, p.market, p.code, p.symbol, p.name, p.currency,
                ps.id, ps.quantity, ps.average_cost, ps.current_weight, ps.max_weight,
                ps.unrealized_pnl, ps.snapshot_as_of, ps.created_at
    )
    select rp.market,
           rp.code,
           rp.symbol,
           rp.name,
           rp.quantity,
           rp.average_cost,
           rp.current_weight,
           rp.max_weight,
           rp.unrealized_pnl,
           'holding'::text as status,
           rp.source_as_of,
           rp.imported_at,
           rp.snapshot_created_at as fetched_at,
           rp.account_scope_id,
           'pingan_imported_snapshot'::text as source_system,
           'owner_selected_imported_snapshot'::text as source_class,
           'owner-selected-pingan-imported-snapshot'::text as source_label,
           rp.currency,
           'broker_import_batches:' || rp.batch_id ||
             '/broker_trades:' || rp.trade_count::text ||
             '/position_snapshots:' || rp.snapshot_id as source_row_id,
           greatest(rp.imported_at, rp.snapshot_created_at) as updated_at
      from reconciled_positions rp
     where rp.trade_count > 0
       and rp.reconciled_transaction_quantity = rp.quantity
     order by rp.symbol
  $query$;
end;
$$;

create or replace view pingan_imported_snapshot_positions as
select *
  from pingan_imported_snapshot_position_rows();

create or replace function pingan_imported_snapshot_conflict_rows()
returns table (
  market text,
  code text,
  account_scope_id text,
  source_as_of timestamptz,
  imported_at timestamptz,
  fetched_at timestamptz,
  conflict_reason text,
  conflicting_row_count bigint
)
language sql
stable
as $$
  select validation.market,
         validation.code,
         validation.account_scope_id,
         validation.source_as_of,
         validation.imported_at,
         validation.fetched_at,
         validation.conflict_reason,
         validation.conflicting_row_count
    from pingan_imported_snapshot_batch_validation_rows() validation
   where validation.conflict_reason is not null;
$$;

create or replace view pingan_imported_snapshot_conflicts as
select *
  from pingan_imported_snapshot_conflict_rows();

create or replace view pingan_imported_snapshot_boundary_health as
select '2026-07-19.core-1b-pingan-full-snapshot-boundary.v3'::text as boundary_version,
       pingan_imported_snapshot_source_ready() as source_tables_available,
       now() as checked_at;

comment on view pingan_imported_snapshot_positions is
  'Governed read-only Pingan current-development boundary. Only the newest uniquely selected import batch with a valid full-account manifest and exact position-snapshot bindings is exposed.';
comment on view pingan_imported_snapshot_conflicts is
  'Account-scoped manifest, batch, symbol-set, snapshot-binding, and reconciliation failures that block all portfolio and risk output.';
comment on view pingan_imported_snapshot_boundary_health is
  'Read-only boundary health. Missing manifest support or source tables fail closed; no older batch fallback is permitted.';

-- Rollback/down is limited to the manifest and v3 boundary objects. Restoring
-- the v2 functions from 005 is required before dropping this table.
-- drop function if exists reject_pingan_import_batch_manifest_mutation();
-- drop table if exists pingan_import_batch_manifests;
