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
           ('position_snapshots', 'created_at')
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
    with approved_batches as (
      select b.id,
             b.account_ref::text as account_scope_id,
             b.created_at as imported_at
        from broker_import_batches b
       where lower(b.source::text) in ('pingan', 'pingan_imported_snapshot')
         and b.status in ('approved', 'succeeded', 'imported')
         and nullif(b.account_ref::text, '') is not null
         and b.account_ref::text !~* '(sample|fixture|migrated|shadow|quant|research|unknown-stale)'
    ),
    batch_rank as (
      select approved_batches.*,
             row_number() over (
               partition by account_scope_id
               order by imported_at desc, id desc
             ) as import_rank,
             count(*) over (
               partition by account_scope_id, imported_at
             ) as same_time_count
        from approved_batches
    ),
    selected_batches as (
      select *
        from batch_rank
       where import_rank = 1
         and same_time_count = 1
    ),
    linked_positions as (
      select sb.id as batch_id,
             sb.account_scope_id,
             sb.imported_at,
             p.id as position_id,
             upper(nullif(p.market::text, '')) as market,
             upper(nullif(p.code::text, '')) as code,
             coalesce(nullif(p.symbol::text, ''), upper(nullif(p.market::text, '')) || '.' || upper(nullif(p.code::text, ''))) as symbol,
             nullif(p.name::text, '') as name,
             nullif(p.currency::text, '') as currency,
             p.status::text as position_status,
             ps.id as snapshot_id,
             ps.snapshot_as_of,
             ps.created_at as snapshot_created_at,
             ps.quantity as snapshot_quantity,
             ps.average_cost,
             ps.current_weight,
             ps.max_weight,
             ps.unrealized_pnl,
             sum(
               case
                 when rt.quantity::text ~ '^-?[0-9]+(\.[0-9]+)?$' then rt.quantity::numeric
                 else null
               end
             ) as reconciled_transaction_quantity,
             bool_or(rt.quantity is null or rt.quantity::text !~ '^-?[0-9]+(\.[0-9]+)?$') as malformed_transaction_quantity,
             count(distinct bt.id) as trade_count
        from selected_batches sb
        join broker_raw_transactions rt on rt.batch_id = sb.id
        join broker_trades bt on bt.raw_transaction_id = rt.id
        join positions p on p.id = bt.position_id
                       and p.account_ref::text = sb.account_scope_id
        join lateral (
          select ps1.*
            from position_snapshots ps1
           where ps1.position_id = p.id
           order by ps1.snapshot_as_of desc, ps1.created_at desc, ps1.id desc
           limit 1
        ) ps on true
       where nullif(p.market::text, '') is not null
         and nullif(p.code::text, '') is not null
         and p.status::text = 'holding'
       group by sb.id, sb.account_scope_id, sb.imported_at, p.id, p.market, p.code,
                p.symbol, p.name, p.currency, p.status, ps.id, ps.snapshot_as_of,
                ps.created_at, ps.quantity, ps.average_cost, ps.current_weight,
                ps.max_weight, ps.unrealized_pnl
    )
    select linked_positions.market,
           linked_positions.code,
           linked_positions.symbol,
           linked_positions.name,
           linked_positions.snapshot_quantity::numeric as quantity,
           linked_positions.average_cost::numeric as average_cost,
           linked_positions.current_weight::numeric as current_weight,
           linked_positions.max_weight::numeric as max_weight,
           linked_positions.unrealized_pnl::numeric as unrealized_pnl,
           'holding'::text as status,
           linked_positions.snapshot_as_of as source_as_of,
           linked_positions.imported_at,
           linked_positions.snapshot_created_at as fetched_at,
           linked_positions.account_scope_id,
           'pingan_imported_snapshot'::text as source_system,
           'owner_selected_imported_snapshot'::text as source_class,
           'owner-selected-pingan-imported-snapshot'::text as source_label,
           linked_positions.currency,
           'broker_import_batches:' || linked_positions.batch_id::text ||
             '/broker_trades:' || linked_positions.trade_count::text ||
             '/position_snapshots:' || linked_positions.snapshot_id::text as source_row_id,
           greatest(linked_positions.imported_at, linked_positions.snapshot_created_at) as updated_at
      from linked_positions
     where linked_positions.trade_count > 0
       and linked_positions.malformed_transaction_quantity = false
       and linked_positions.snapshot_quantity is not null
       and linked_positions.reconciled_transaction_quantity = linked_positions.snapshot_quantity
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
language plpgsql
stable
as $$
begin
  if not pingan_imported_snapshot_source_ready() then
    return;
  end if;

  return query execute $query$
    with approved_batches as (
      select b.id,
             b.account_ref::text as account_scope_id,
             b.created_at as imported_at
        from broker_import_batches b
       where lower(b.source::text) in ('pingan', 'pingan_imported_snapshot')
         and b.status in ('approved', 'succeeded', 'imported')
         and nullif(b.account_ref::text, '') is not null
         and b.account_ref::text !~* '(sample|fixture|migrated|shadow|quant|research|unknown-stale)'
    ),
    batch_rank as (
      select approved_batches.*,
             row_number() over (
               partition by account_scope_id
               order by imported_at desc, id desc
             ) as import_rank,
             count(*) over (
               partition by account_scope_id, imported_at
             ) as same_time_count
        from approved_batches
    ),
    selected_batches as (
      select *
        from batch_rank
       where import_rank = 1
         and same_time_count = 1
    ),
    latest_batch_ties as (
      select upper(nullif(p.market::text, '')) as market,
             upper(nullif(p.code::text, '')) as code,
             b.account_ref::text as account_scope_id,
             b.created_at as source_as_of,
             b.created_at as imported_at,
             b.created_at as fetched_at,
             'ambiguous_latest_batch'::text as conflict_reason,
             count(distinct b.id) as conflicting_row_count
        from broker_import_batches b
        join broker_raw_transactions rt on rt.batch_id = b.id
        join broker_trades bt on bt.raw_transaction_id = rt.id
        join positions p on p.id = bt.position_id
       where lower(b.source::text) in ('pingan', 'pingan_imported_snapshot')
         and b.status in ('approved', 'succeeded', 'imported')
         and nullif(b.account_ref::text, '') is not null
       group by p.market, p.code, b.account_ref, b.created_at
      having count(distinct b.id) > 1
    ),
    reconciliation_conflicts as (
      select upper(nullif(p.market::text, '')) as market,
             upper(nullif(p.code::text, '')) as code,
             b.account_ref::text as account_scope_id,
             ps.snapshot_as_of as source_as_of,
             b.created_at as imported_at,
             ps.created_at as fetched_at,
             case
               when count(distinct coalesce(nullif(p.symbol::text, ''), upper(nullif(p.market::text, '')) || '.' || upper(nullif(p.code::text, '')))) > 1 then 'ambiguous_symbol'
               when bool_or(rt.quantity is null or rt.quantity::text !~ '^-?[0-9]+(\.[0-9]+)?$') then 'quantity_mismatch'
               when sum(case when rt.quantity::text ~ '^-?[0-9]+(\.[0-9]+)?$' then rt.quantity::numeric else 0 end) <> ps.quantity then 'quantity_mismatch'
               when count(distinct bt.id) = 0 then 'missing_reconciliation'
               when count(distinct p.id) > 1 then 'duplicate_position'
               else 'duplicate_position'
             end as conflict_reason,
             count(*) as conflicting_row_count
        from selected_batches sb
        join broker_import_batches b on b.id = sb.id
        join broker_raw_transactions rt on rt.batch_id = b.id
        join broker_trades bt on bt.raw_transaction_id = rt.id
        join positions p on p.id = bt.position_id
                           and p.account_ref::text = sb.account_scope_id
        join lateral (
          select ps1.*
            from position_snapshots ps1
           where ps1.position_id = p.id
           order by ps1.snapshot_as_of desc, ps1.created_at desc, ps1.id desc
           limit 1
        ) ps on true
       where p.status::text = 'holding'
       group by p.market, p.code, b.account_ref, ps.snapshot_as_of, b.created_at, ps.created_at, ps.quantity
      having count(distinct p.id) > 1
          or count(distinct coalesce(nullif(p.symbol::text, ''), upper(nullif(p.market::text, '')) || '.' || upper(nullif(p.code::text, '')))) > 1
          or bool_or(rt.quantity is null or rt.quantity::text !~ '^-?[0-9]+(\.[0-9]+)?$')
          or sum(case when rt.quantity::text ~ '^-?[0-9]+(\.[0-9]+)?$' then rt.quantity::numeric else 0 end) <> ps.quantity
    )
    select market, code, account_scope_id, source_as_of, imported_at, fetched_at,
           conflict_reason, conflicting_row_count
      from latest_batch_ties
    union all
    select market, code, account_scope_id, source_as_of, imported_at, fetched_at,
           conflict_reason, conflicting_row_count
      from reconciliation_conflicts
  $query$;
end;
$$;

create or replace view pingan_imported_snapshot_conflicts as
select *
  from pingan_imported_snapshot_conflict_rows();

create or replace view pingan_imported_snapshot_boundary_health as
select '2026-06-27.core-1b-pingan-snapshot-boundary.v2'::text as boundary_version,
       pingan_imported_snapshot_source_ready() as source_tables_available,
       now() as checked_at;

comment on view pingan_imported_snapshot_positions is
  'Governed read-only Pingan imported snapshot application boundary; derives from selected Pingan import batches through raw transaction, broker trade, position, and position snapshot facts.';
comment on view pingan_imported_snapshot_conflicts is
  'Companion read-only boundary listing account/symbol scoped ambiguity and reconciliation conflicts that must fail closed.';
comment on view pingan_imported_snapshot_boundary_health is
  'Read-only boundary health; API exposure requires source_tables_available and evaluates conflicts per request scope.';

-- Rollback/down for this repository migration is limited to the new boundary
-- objects only:
-- drop view if exists pingan_imported_snapshot_boundary_health;
-- drop view if exists pingan_imported_snapshot_conflicts;
-- drop view if exists pingan_imported_snapshot_positions;
-- drop function if exists pingan_imported_snapshot_conflict_rows();
-- drop function if exists pingan_imported_snapshot_position_rows();
-- drop function if exists pingan_imported_snapshot_source_ready();
