alter table assets_alpha_snapshots
  drop constraint assets_alpha_snapshots_positions_check;

alter table assets_alpha_snapshots
  add constraint assets_alpha_snapshots_positions_check check (
    jsonb_typeof(positions) = 'array'
    and jsonb_array_length(positions) between 0 and 100
  );
