-- Owner-entered current holdings reuse the actor-scoped append-only snapshot ledger.
-- No broker transactions or imported Pingan facts are altered.
alter table assets_alpha_snapshots drop constraint assets_alpha_snapshots_source_check;
alter table assets_alpha_snapshots add constraint assets_alpha_snapshots_source_check
  check (source in ('manual', 'csv', 'owner_current'));
-- Rollback requires preserving owner_current records first; never relabel them as Pingan imports.
