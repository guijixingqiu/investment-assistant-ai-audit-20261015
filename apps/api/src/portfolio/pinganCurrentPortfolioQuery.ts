export const PINGAN_CURRENT_PORTFOLIO_READ_QUERY = `with requested_positions as (
  select p.*
    from pingan_imported_snapshot_positions p
   where p.account_scope_id = $1
     and p.status = 'holding'
),
validated_batch as (
  select validation.batch_id,
         validation.account_scope_id,
         validation.source_as_of,
         validation.imported_at,
         validation.fetched_at,
         validation.snapshot_group_id
    from pingan_imported_snapshot_batch_validation_rows() validation
   where validation.account_scope_id = $1
     and validation.conflict_reason is null
   order by validation.imported_at desc, validation.batch_id desc
   limit 1
),
account_holding_positions as (
  select upper(nullif(p.market::text, '')) as market,
         upper(nullif(p.code::text, '')) as code,
         coalesce(
           nullif(p.symbol::text, ''),
           upper(nullif(p.market::text, '')) || '.' || upper(nullif(p.code::text, ''))
         ) as symbol
    from positions p
   where p.account_ref::text = $1
     and p.status::text = 'holding'
),
account_boundary_issues as (
  select conflict_reason as reason
    from pingan_imported_snapshot_conflicts
   where account_scope_id = $1
  union all
  select 'incomplete_account_snapshot'::text
   where (select count(*) from account_holding_positions)
         <> (select count(*) from requested_positions)
      or exists (
           select 1
             from account_holding_positions h
            where h.market is null
               or h.code is null
               or h.symbol is null
               or h.market <> 'HK'
               or h.code !~ '^[0-9]{5}$'
               or h.symbol <> 'HK.' || h.code
         )
      or exists (
           select 1
             from account_holding_positions h
            group by h.symbol
           having count(*) <> 1
         )
      or exists (
           select 1
             from requested_positions p
            group by p.symbol
           having count(*) <> 1
         )
      or (select count(distinct h.symbol) from account_holding_positions h)
         <> (select count(distinct p.symbol) from requested_positions p)
      or exists (
           select 1
             from account_holding_positions h
            where not exists (
              select 1
                from requested_positions p
               where p.symbol = h.symbol
            )
         )
      or exists (
           select 1
             from requested_positions p
            where not exists (
              select 1
                from account_holding_positions h
               where h.symbol = p.symbol
            )
         )
)
select p.market, p.code, p.symbol, p.name, p.quantity, p.average_cost,
       p.current_weight, p.max_weight, p.unrealized_pnl, p.status,
       p.source_as_of, p.imported_at, p.fetched_at, p.account_scope_id,
       p.source_system, p.source_class, p.source_label, p.currency,
       p.source_row_id, p.updated_at,
       validated.batch_id as validated_batch_id,
       validated.account_scope_id as validated_account_scope_id,
       validated.source_as_of as validated_source_as_of,
       validated.imported_at as validated_imported_at,
       validated.fetched_at as validated_fetched_at,
       validated.snapshot_group_id as validated_snapshot_group_id,
       coalesce((select source_tables_available
                   from pingan_imported_snapshot_boundary_health
                  limit 1), false) as boundary_ready,
       (select string_agg(distinct reason, ',' order by reason)
          from account_boundary_issues) as conflict_reason
  from (select 1) request
  left join requested_positions p on true
  left join validated_batch validated on true
 order by p.symbol, p.source_row_id`;
